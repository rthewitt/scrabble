
var _ = require('underscore');
var repl = require('repl');
var http = require('http');
var util = require('util');
var os = require('os');
var fs = require('fs');
var io = require('socket.io');
var nodemailer = require('nodemailer');
var express = require('express');
var crypto = require('crypto');
var negotiate = require('express-negotiate');
var argv = require('optimist')
    .options('d', {
        alias: 'database',
        'default': 'data.db'
    })
    .options('c', {
        alias: 'config'
    })
    .argv;


var scrabble = require('./client/javascript/scrabble.js');
var icebox = require('icebox');
var DB = require('./db.js');

var EventEmitter = require('events').EventEmitter;

// //////////////////////////////////////////////////////////////////////

function maybeLoadConfig() {

    var config = {};

    function readConfig(filename) {
        try {
            return JSON.parse(fs.readFileSync(filename));
        }
        catch (e) {
            console.log('error reading configuration:\n' + e);
            process.exit(1);
        }            
    }

    var defaultConfig = readConfig(__dirname + "/config-default.json");

    if (argv.config) {
        var fileName = argv.config;
        if (!fileName.match(/^\//)) {
            fileName = __dirname + '/' + fileName;
        }
        if (!fs.existsSync(fileName)) {
            console.log('cannot find configuration file', fileName);
            process.exit(1);
        }
        config = readConfig(fileName);
    } else if (fs.existsSync(__dirname + "/config.json")) {
        config = readConfig(__dirname + "/config.json");
    }
    config.__proto__ = defaultConfig;
    return config;
}

var config = maybeLoadConfig();
console.log('config', config);

// //////////////////////////////////////////////////////////////////////

var smtp = nodemailer.createTransport('SMTP', config.mailTransportConfig);

var app = express();
var server = app.listen(config.port)
var io = io.listen(server);
var db = new DB.DB(argv.database);

io.set('log level', 1);

app.configure(function() {
    app.use(express.methodOverride());
    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.static(__dirname + '/client'));
    app.use(express.errorHandler({
        dumpExceptions: true, 
        showStack: true
    }));
    app.use(app.router);
});

app.get("/", function(req, res) {
  res.redirect("/games.html");
});

db.on('load', function() {
    console.log('database loaded');
});

db.registerObject(scrabble.Tile);
db.registerObject(scrabble.Square);
db.registerObject(scrabble.Board);
db.registerObject(scrabble.Rack);
db.registerObject(scrabble.LetterBag);

function makeKey() {
    return crypto.randomBytes(8).toString('hex');
}

// Game //////////////////////////////////////////////////////////////////

function Game() {
}

util.inherits(Game, EventEmitter);

db.registerObject(Game);

Game.create = function(language, players) {
    var game = new Game();
    game.language = language;
    game.players = players;
    game.key = makeKey();
    game.letterBag = scrabble.LetterBag.create(language);
    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        player.index = i;
        player.rack = new scrabble.Rack(8);
        for (var j = 0; j < 7; j++) {
            player.rack.squares[j].tile = game.letterBag.getRandomTile();
        }
        player.score = 0;
    }
    console.log('players', players);
    game.board = new scrabble.Board();
    game.turns = [];
    game.whosTurn = 0;
    game.passes = 0;
    game.save();
    game.players.forEach(function (player) {
        game.sendInvitation(player);
    });
    return game;
}

Game.prototype.makeLink = function(player)
{
    var url = config.baseUrl + "game/" + this.key;
    if (player) {
        url += "/" + player.key;
    }
    return url;
}

function joinProse(array)
{
    var length = array.length;
    switch (length) {
    case 0:
        return "";
    case 1:
        return array[0];
    default:
        return _.reduce(array.slice(1, length - 1), function (word, accu) { return word + ", " + accu }, array[0]) + " and " + array[length - 1];
    }
}

Game.prototype.sendInvitation = function(player)
{
    try {
        smtp.sendMail({ from: config.mailSender,
                        to: [ player.email ],
                        subject: 'You have been invited to play Scrabble with ' + joinProse(_.pluck(_.without(this.players, player), 'name')),
                        text: 'Use this link to play:\n\n' + this.makeLink(player),
                        html: 'Click <a href="' + this.makeLink(player) + '">here</a> to play.' },
                      function (err) {
                          if (err) {
                              console.log('sending mail failed', err);
                          }
                      });
    }
    catch (e) {
        console.log('cannot send mail:', e);
    }
}

Game.prototype.save = function(key) {
    db.set(this.key, this);
}

Game.load = function(key) {
    if (!this.games) {
        this.games = {};
    }
    if (!this.games[key]) {
        var game = db.get(key);
        if (!game) {
            return null;
        }
        EventEmitter.call(game);
        game.connections = [];
        Object.defineProperty(game, 'connections', { enumerable: false }); // makes connections non-persistent
        this.games[key] = game;
    }
    return this.games[key];
}

Game.prototype.notifyListeners = function(message, data) {
    this.connections.forEach(function (socket) {
        socket.emit(message, data);
    });
}

Game.prototype.lookupPlayer = function(req, suppressException) {
    var playerKey = req.cookies[this.key];
    var blob='';
    for(cookie in req.cookies) {
        blob+=req.cookies[cookie];
    }
    console.log('Full cookies: '+blob);
    console.log('Player Key located: '+playerKey);
    for (var i in this.players) {
        if (this.players[i].key == playerKey) {
            return this.players[i];
        }
    }
    console.warn('invalid player key '+playerKey); // debugging
    if (!suppressException) {
        throw "invalid player key " + playerKey + " for game " + this.key;
    }
}

Game.prototype.ensurePlayerAndGame = function(player) {
    var game = this;

    if (game.ended()) {
        throw "this game has ended: " + game.endMessage.reason;
    }

    // determine if it is this player's turn
    if (player !== game.players[game.whosTurn]) {
        throw "not this player's turn";
    }
}

Game.prototype.makeMove = function(player, placementList) {
    console.log('makeMove', placementList);

    var game = this;

    // validate the move (i.e. does the user have the tiles placed, are the tiles free on the board
    var rackSquares = player.rack.squares.slice();          // need to clone
    var turn;
    var placements = placementList.map(function (placement) {
        var fromSquare = null;
        for (var i = 0; i < rackSquares.length; i++) {
            var square = rackSquares[i];
            if (square && square.tile &&
                (square.tile.letter == placement.letter
                 || (square.tile.isBlank() && placement.blank))) {
                if (placement.blank) {
                    square.tile.letter = placement.letter;
                }
                fromSquare = square;
                delete rackSquares[i];
                break;
            }
        }
        if (!fromSquare) {
            throw 'cannot find letter ' + placement.letter + ' in rack of player ' + player.name;
        }
        placement.score = fromSquare.tile.score;
        var toSquare = game.board.squares[placement.x][placement.y];
        if (toSquare.tile) {
            throw 'target tile ' + placement.x + '/' + placement.y + ' is already occupied';
        }
        return [fromSquare, toSquare];
    });
    placements.forEach(function(squares) {
        var tile = squares[0].tile;
        squares[0].placeTile(null);
        squares[1].placeTile(tile);
    });
    var move = scrabble.calculateMove(game.board.squares);
    if (move.error) {
        // fixme should be generalized function -- wait, no rollback? :|
        placements.forEach(function(squares) {
            var tile = squares[1].tile;
            squares[1].placeTile(null);
            squares[0].placeTile(tile);
        });
        throw move.error;
    }
    placements.forEach(function(squares) {
        squares[1].tileLocked = true;
    });

    // add score
    player.score += move.score;

    // get new tiles
    var newTiles = game.letterBag.getRandomTiles(placements.length);
    for (var i = 0; i < newTiles.length; i++) {
        placements[i][0].placeTile(newTiles[i]);
    }

    game.previousMove = { placements: placements,
                          newTiles: newTiles,
                          score: move.score,
                          player: player };
    game.passes = 0;

    return [ newTiles,
             { type: 'move',
               player: player.index,
               score: move.score,
               move: move,
               placements: placementList } ];
}

Game.prototype.challengeOrTakeBackMove = function(type, player) {
    game = this;
    if (!game.previousMove) {
        throw 'cannot challenge move - no previous move in game';
    }
    var previousMove = game.previousMove;
    delete game.previousMove;

    var returnLetters = [];
    previousMove.placements.map(function(placement) {
        var rackSquare = placement[0];
        var boardSquare = placement[1];
        if (rackSquare.tile) {
            returnLetters.push(rackSquare.tile.letter);
            game.letterBag.returnTile(rackSquare.tile);
            rackSquare.placeTile(null);
        }
        rackSquare.placeTile(boardSquare.tile);
        boardSquare.placeTile(null);
    });
    previousMove.player.score -= previousMove.score;

    return [ [],
             { type: type,
               challenger: player.index,
               player: previousMove.player.index,
               score: -previousMove.score,
               whosTurn: ((type == 'challenge') ? game.whosTurn : previousMove.player.index),
               placements: previousMove.placements.map(function(placement) {
                   return { x: placement[1].x,
                            y: placement[1].y }
               }),
               returnLetters: returnLetters } ];
}

Game.prototype.pass = function(player) {
    var game = this;
    delete game.previousMove;
    game.passes++;

    return [ [],
             { type: 'pass',
               score: 0,
               player: player.index } ];
}

Game.prototype.returnPlayerLetters = function(player, letters) {
    var game = this;
    // return letter squares from the player's rack
    var lettersToReturn = new scrabble.Bag(letters);
    game.letterBag.returnTiles(_.reduce(player.rack.squares,
                                        function(accu, square) {
                                            if (square.tile && lettersToReturn.contains(square.tile.letter)) {
                                                lettersToReturn.remove(square.tile.letter);
                                                accu.push(square.tile);
                                                square.placeTile(null);
                                            }
                                            return accu;
                                        },
                                        []));
    if (lettersToReturn.contents.length) {
        throw "could not find letters " + lettersToReturn.contents + " to return on player " + player + "'s rack";
    }
}

Game.prototype.swapTiles = function(player, letters) {
    var game = this;

    if (game.letterBag.remainingTileCount() < 7) {
        throw 'cannot swap, letterbag contains only ' + game.letterBag.remainingTileCount() + ' tiles';
    }
    delete game.previousMove;
    game.passes++;
    var rackLetters = new scrabble.Bag(player.rack.letters());
    letters.forEach(function (letter) {
        if (rackLetters.contains(letter)) {
            rackLetters.remove(letter);
        } else {
            throw 'cannot swap, rack does not contain letter "' + letter + '"';
        }
    });

    // The swap is legal.  First get new tiles, then return the old ones to the letter bag
    var newTiles = game.letterBag.getRandomTiles(letters.length);
    game.returnPlayerLetters(player, letters);

    var tmpNewTiles = newTiles.slice();
    player.rack.squares.forEach(function(square) {
        if (!square.tile) {
            square.placeTile(tmpNewTiles.pop());
        }
    });

    return [ newTiles,
             { type: 'swap',
               score: 0,
               count: letters.length,
               player: player.index } ];
}

Game.prototype.remainingTileCounts = function() {
    var game = this;

    return { letterBag: game.letterBag.remainingTileCount(),
             players: game.players.map(function(player) {
                 var count = 0;
                 player.rack.squares.forEach(function(square) {
                     if (square.tile) {
                         count++;
                     }
                 });
                 return count;
             })
           };
}

Game.prototype.finishTurn = function(player, newTiles, turn) {
    var game = this;

    // store turn log
    game.turns.push(turn);

    // determine whether the game's end has been reached
    if (game.passes == (game.players.length * 2)) {
        game.finish('all players passed two times');
    } else if (_.every(player.rack.squares, function(square) { return !square.tile; })) {
        game.finish('player ' + game.whosTurn + ' ended the game');
    } else if (turn.type != 'challenge') {
        // determine who's turn it is now
        game.whosTurn = (game.whosTurn + 1) % game.players.length;
        turn.whosTurn = game.whosTurn;
    }

    // store new game data
    game.save();

    // notify listeners
    turn.remainingTileCounts = game.remainingTileCounts();
    game.notifyListeners('turn', turn);

    // if the game has ended, send extra notification with final scores
    if (game.ended()) {
        endMessage = icebox.freeze(game.endMessage);
        game.connections.forEach(function (socket) {
            socket.emit('gameEnded', endMessage);
        });
    }

    return { newTiles: newTiles };
}

Game.prototype.createFollowonGame = function(startPlayer) {
    if (this.nextGameKey) {
        throw 'followon game already created: old ' + this.key + ' new ' + this.nextGameKey;
    }
    var oldGame = this;
    var playerCount = oldGame.players.length;
    var newPlayers = [];
    for (var i = 0; i < playerCount; i++) {
        var oldPlayer = oldGame.players[(i + startPlayer.index) % playerCount];
        newPlayers.push({ name: oldPlayer.name,
                          email: oldPlayer.email,
                          key: oldPlayer.key });
    }
    var newGame = Game.create(oldGame.language, newPlayers);
    oldGame.endMessage.nextGameKey = newGame.key;
    oldGame.save();
    newGame.save();

    oldGame.notifyListeners('nextGame', newGame.key);
}

Game.prototype.finish = function(reason) {
    var game = this;

    delete game.whosTurn;

    // Tally scores  
    var playerWithNoTiles;
    var pointsRemainingOnRacks = 0;
    game.players.forEach(function(player) {
        var tilesLeft = false;
        var rackScore = 0;
        player.rack.squares.forEach(function (square) {
            if (square.tile) {
                rackScore += square.tile.score;
                tilesLeft = true;
            }
        });
        if (tilesLeft) {
            player.score -= rackScore;
            player.tallyScore = -rackScore;
            pointsRemainingOnRacks += rackScore;
        } else {
            if (playerWithNoTiles) {
                throw "unexpectedly found more than one player with no tiles when finishing game";
            }
            playerWithNoTiles = player;
        }
    });

    if (playerWithNoTiles) {
        playerWithNoTiles.score += pointsRemainingOnRacks;
        playerWithNoTiles.tallyScore = pointsRemainingOnRacks;
    }

    var endMessage = { reason: reason,
                       players: game.players.map(function(player) {
                           return { name: player.name,
                                    score: player.score,
                                    tallyScore: player.tallyScore,
                                    rack: player.rack };
                       })
                     };
    game.endMessage = endMessage;

    db.snapshot();
}

Game.prototype.ended = function() {
    return this.endMessage;
}

Game.prototype.newConnection = function(socket, player) {
    var game = this;
    if (!game.connections) {
        game.connections = [];
    }
    game.connections.push(socket);
    socket.game = game;
    if (player) {
        socket.player = player;
        game.notifyListeners('join', player.index);
    }
    socket.on('disconnect', function () {
        game.connections = _.without(game.connections, this);
        if (player) {
            game.notifyListeners('leave', player.index);
        }
    });
}

// Authentication for game list///////////////////////////////////////////////

var gameListAuth = express.basicAuth(function(username, password) {
    if (config.gameListLogin) {
        return username == config.gameListLogin.username && password == config.gameListLogin.password;
    } else {
        return true;
    }
}, "Enter game list access login");

// Handlers //////////////////////////////////////////////////////////////////

app.get("/games", config.gameListLogin ? gameListAuth : function (req, res, next) { next(); }, function(req, res) {
    res.send(db.all().map(function(game) {
        return { key: game.key,
                 players: game.players.map(function(player) {
                     return { name: player.name,
                              key: player.key };
                 })};
    }));
});

/*
app.get("/game", function(req, res) {
    res.sendfile(__dirname + '/client/make-game.html');
});
*/
/*
app.post("/game", function(req, res) {

    var players = [];
    [1, 2, 3, 4].forEach(function (x) {
        var name = req.body['name' + x];
        var email = req.body['email' + x];
        console.log('name', name, 'email', email, 'params', req.params);
        if (name && email) {
            players.push({ name: name,
                           email: email,
                           key: makeKey() });
        }
    });

    if (players.length < 2) {
        throw 'at least two players must participate in a game';
    }

    console.log(players.length, 'players');
    var game = Game.create(req.body.language || 'German', players);

    res.redirect("/game/" + game.key + "/" + game.players[0].key);
});
*/

////////////////////   AIMA ADDITIONS   ////////////////////////////////////
function AIMACreate(playerName, language) {
    var players = [];
    players.push({ name: playerName,
                   email: playerName+'@mpi.edu',
                   key: makeKey() });
    players.push({ name: 'bot',
                   email: 'bot@mpi.edu',
                   key: makeKey() });
    return Game.create(language || 'English', players);
}

function authenticateAIMA(playerName) {
    var validUser = false;
    for(var u in config.aima) 
        if(config.aima[u] === playerName)
            validUser = true;
    return validUser;
}
// Load if found, otherwise create new
app.get("/login/:playerName", function(req, res) {
    var playerName = req.params.playerName;
    if(!authenticateAIMA(playerName)) {
        res.redirect("/games.html");
        return;
    }

    var theGame = null;
    var playerIndex = 0;
    db.all().map(function(game) {
        for(var player in game.players) {
            if(game.players[player].name === playerName) {
                theGame = game;
                playerIndex = player;
                break;
            }
        }
    });
    if(!theGame) theGame = AIMACreate(playerName, 'English');
        
    res.redirect("/game/" + theGame.key + "/" + theGame.players[playerIndex].key);
});

app.get("/login/:playerName/bot", function(req, res) {
    req.negotiate({
        'application/json': function () {
            var playerName = req.params.playerName;
            var theGame = null;
            db.all().map(function(game) {
                for(var player in game.players) {
                    if(game.players[player].name === playerName) {
                        theGame = game;
                        break;
                    }
                }
            });

            // looping twice due to edge cases
            var success = false;
            var playerKey;
            var playerIndex;
            if(theGame) {
                for(var player in theGame.players) {
                    if(theGame.players[player].name === 'bot') {
                        playerKey = theGame.players[player].key
                        playerIndex = player;
                        success = true;
                    }
                }
            }
            response = { success: success, gameKey: (theGame ? theGame.key : undefined), playerKey: playerKey, playerIndex: playerIndex };
            res.send(response);
        }
    });
});

app.get("/login/:playerName/new", function(req, res) {
    if(!authenticateAIMA(req.params.playerName)){
        res.redirect("/games.html");
        return;
    }
    // Delete all games that the user has started.  (Should only be one for AIMA)
    db.all().map(function(game) {
        for(var player in game.players)
            if(game.players[player].name === req.params.playerName) 
                db.del(game.key);
    });
    res.redirect("/login/"+req.params.playerName);
});
////////////////////////////////////////////////////////////////////////////

function gameHandler(handler) {
    return function(req, res) {
        var gameKey = req.params.gameKey;
        var game = Game.load(gameKey);
        if (!game) {
            throw "Game " + req.params.gameKey + " does not exist";
        }
        handler(game, req, res);
    }
}

function playerHandler(handler) {
    return gameHandler(function(game, req, res) {
        var player = game.lookupPlayer(req);
        handler(player, game, req, res);
    });
}

app.get("/game/:gameKey/:playerKey", gameHandler(function (game, req, res) {
    res.cookie(req.params.gameKey, req.params.playerKey, { path: '/', maxAge: (30 * 24 * 60 * 60 * 1000) });
    res.redirect("/game/" + req.params.gameKey);
}));

app.get("/game/:gameKey", gameHandler(function (game, req, res, next) {
    req.negotiate({
        'application/json': function () {
            var response = { board: game.board,
                             turns: game.turns,
                             language: game.language,
                             whosTurn: game.whosTurn,
                             remainingTileCounts: game.remainingTileCounts(),
                             legalLetters: game.letterBag.legalLetters,
                             players: [] }
            var thisPlayer = game.lookupPlayer(req, true);
            for (var i = 0; i < game.players.length; i++) {
                var player = game.players[i];
                console.log('This player: ' + thisPlayer + ' against index ' + player.key + ' with rack' + player.rack);
                response.players.push({ name: player.name,
                                        score: player.score,
                                        rack: ((player == thisPlayer) ? player.rack : null) });
            }
            if (game.ended()) {
                response.endMessage = game.endMessage;
            }
            res.send(icebox.freeze(response));
        },
        'html': function () {
            res.sendfile(__dirname + '/client/game.html');
        }
    });
}));

app.put("/game/:gameKey", playerHandler(function(player, game, req, res) {
    var body = req.body.api ? req.body : icebox.thaw(req.body);
    console.log('put', game.key, 'player', player.name, 'command', body.command, 'arguments', req.body.arguments, '\nTEST', req.body);
    var tilesAndTurn;
    switch (req.body.command) {
    case 'makeMove':
        game.ensurePlayerAndGame(player);
        tilesAndTurn = game.makeMove(player, body.arguments);
        break;
    case 'pass':
        game.ensurePlayerAndGame(player);
        tilesAndTurn = game.pass(player);
        break;
    case 'swap':
        game.ensurePlayerAndGame(player);
        tilesAndTurn = game.swapTiles(player, body.arguments);
        break;
    case 'challenge':
    case 'takeBack':
        tilesAndTurn = game.challengeOrTakeBackMove(req.body.command, player);
        break;
    case 'newGame':
        game.createFollowonGame(player);
        break;
    default:
        throw 'unrecognized game PUT command: ' + body.command;
    }
    if (tilesAndTurn) {
        var tiles = tilesAndTurn[0];
        var turn = tilesAndTurn[1];
        var result = game.finishTurn(player, tiles, turn);
        res.send(icebox.freeze(result));
    }
}));

io.sockets.on('connection', function (socket) {
    socket
        .on('join', function(data) {
            var socket = this;
            var game = Game.load(data.gameKey);
            if (!game) {
                console.log("game " + data.gameKey + " not found");
            } else {
                var player;
                game.players.map(function(player_) {
                    if (player_.key == data.playerKey) {
                        player = player_;
                    } else {
                        if (_.find(game.connections, function(connection) { return connection.player == player_ })) {
                            socket.emit('join', player_.index);
                        }
                    }
                });
                if (data.playerKey && !player) {
                    console.log('player ' + data.playerKey + ' not found');
                }
                game.newConnection(socket, player);
            }
        })
        .on('message', function(message) {
            this.game.notifyListeners('message', message);
        });
});

var repl = repl.start({
  prompt: "scrabble> ",
  input: process.stdin,
  output: process.stdout
});

repl.context.db = db;
repl.context.Game = Game;
repl.context.DB = DB;
repl.context.config = config;
