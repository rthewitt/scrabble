var fs = require('fs');
var express = require('express');
var request = require('request');
var wordArray = require('../words/20000-random-array.json').words;
var Gaddag = require('../gaddag/gaddag.js').Gaddag;
var log = require('../gaddag/util.js').log;


console.log('Scrabble Bot, reporting for duty.');

var _scp = this;

// Temporary force data structure
_scp.gaddag = new Gaddag();
_scp.gaddag.addAll(wordArray);

_scp.MPI = 'http://myelinprice.com';
_scp.MPI_PORT = '1337';

_scp.server=null,
_scp.port=null;

_scp.gameId = null;
_scp.userId = null;
_scp.userName = null;
_scp.PLAYER_ID = 1;  
_scp.thinking = false;

_scp.cookieJar = null;

_scp.configure = function(url, port, delay){
    _scp.server = url || _scp.MPI;
    //_scp.port = port || process.env.PORT || _scp.MPI_PORT; 
    _scp.port = port || _scp.MPI_PORT; // Currently loading from website, not locally
    _scp.delay = delay || 1500;
}

_scp.BOARD_LENGTH = 15;
_scp.DIRECTIONS = ['RIGHT','DOWN'];

var stupid = function(state) {
    var loc = {x:7, y:7};
    var found = false;
    while(loc.x <= 13 && !found) {
        var space = state.board.squares[loc.x][loc.y];
        if(space.tileLocked) {
            loc.x++;
            continue;
        } else found = true;
    }

    var pieceToPlay;
    console.log('player '+state.players[_scp.PLAYER_ID].name);
    var pSet = state.players[_scp.PLAYER_ID].rack.squares;
    for(piece in pSet) {
        if(pSet[piece].type !== "Normal") continue; // TODO set this differently on server?
        if(pSet[piece].tile.letter === ' ') // blank
            pSet.splice(piece, 1); // Durrrrrr
        else {
            pieceToPlay = pSet[piece];
            break;
        }
    }
     var dex = '';
    for(var x in pieceToPlay) dex+=(' '+x);
    if(!pieceToPlay) console.warn('no suitable piece found');
    else console.log('using piece: '+dex);
     console.log('id: '+pieceToPlay['_id']+'\nconst: '+pieceToPlay['_constructorName']+'\ntype: '+pieceToPlay['type']);
    console.log('dot notation: '+pieceToPlay.type);

    //_scp.makeMove({letter:pieceToPlay.tile.letter, x:loc.x, y:loc.y, blank:false});
    _scp.makeMove({letter:'E', x:loc.x, y:loc.y, blank:false});
}

_scp.strategy = stupid;

// Log in
_scp.connect = function(user){

    if(!(_scp.server && _scp.port)) 
        throw "I ain't been configured yet!";

    if(!user) throw "Gotta tell me who you are boss";

    _scp.userName = user;

    request({ json: true, uri: _scp.server+':'+_scp.port+'/login/'+user+'/bot'}, 
        function(err, res, data){
            if(!err && res.statusCode == 200) {
                try {
                    if(!data.success) // test "falsey" values
                        throw "Scrabble failure?";
                    _scp.gameId = data.gameKey;
                    _scp.userId = data.playerKey;
                    _scp.PLAYER_ID = data.playerIndex;
                    var cookieJar = request.jar();
                    var cookie = request.cookie(_scp.gameId+'='+_scp.userId);
                    cookieJar.add(cookie);
                    console.log('cookie: '+cookie);
                    _scp.cookieJar = cookieJar;
                    _scp.play();
                } catch(e){
                    console.error(e);
                    throw "I knocked, where the hell are ya?";
                }
            } else {
                console.error(err);
                throw "Looks like nobody's home...";
            }
        });
}

_scp.makeMove = function(){
    var args = [].slice.call(arguments);
    var data = {command: "makeMove", api: true, arguments: args};

    console.log('sending: '+JSON.stringify(data));
    request({
        method: 'PUT',
        uri: _scp.server+':'+_scp.port+'/game/'+_scp.gameId,
        json: true,
        jar: _scp.cookieJar,
        body: data
    }, function(error, response, body){
        if(response.statusCode == 200) {
            console.log("I hear that.");
            console.log(body)
        } else {
            console.error("I'm not reading you clearly.");
        }
    });
}

// TODO combine these methods using command name and args
_scp.pass = function(){
    var data = {command: "pass", api: true};

    console.log('sending: '+JSON.stringify(data));
    request({
        method: 'PUT',
        uri: _scp.server+':'+_scp.port+'/game/'+_scp.gameId,
        json: true,
        jar: _scp.cookieJar,
        body: data
    }, function(error, response, body){
        if(response.statusCode == 200) {
            console.log("Failure is unacceptable...");
            console.log(body)
        } else {
            console.error("Apparently not an option.");
        }
    });
}

_scp.play = function() {
    if(!_scp.gameId || !_scp.userId) {
        throw "You want me to play with myself?";
    } 
    
    
    var pollForChanges = function(){
       if(_scp.thinking) return;
        request({uri:_scp.server+':'+_scp.port+'/game/'+_scp.gameId, jar: _scp.cookieJar}, 
        function(error, response, body){
            if(!error && response.statusCode == 200) {
                var state = JSON.parse(body);
                if(state.whosTurn == _scp.PLAYER_ID){
                    _scp.thinking = true;
                    _scp.me = state.players[_scp.PLAYER_ID];
                    if(_scp.hook && typeof _scp.hook == 'function')
                        _scp.hook.call(_scp);
                    _scp.strategy.call(_scp, state); 
                    _scp.thinking = false;
                }
                setTimeout(function(){ return pollForChanges()},_scp.delay);
            } else  console.warn("Unable to poll game server", error); 
        });
    }
    
    
    
    /* Example Response: 
    
    { _id:0,
      newTiles:[
        {
          _id:2,
          _constructorName: "Tile",
          letter:"I",
          score:1
         }
       ]}
    
    */
    
    pollForChanges();
}

var app = express();
var server = app.listen(process.env.PORT)

// Revisit
app.configure(function() {
    app.use(express.methodOverride());
    app.use(express.bodyParser());
    app.use(express.cookieParser()); // necessary?
    app.use(express.static(__dirname + '/html'));
    app.use(express.errorHandler({
        dumpExceptions: true, 
        showStack: true
    }));
    app.use(app.router);
});

app.get("/", function(req, res) {
    console.log("What is happening");
    if(!(_scp.server && _scp.port))
        throw "Bot not yet configured"; // Just use a page
    res.redirect(_scp.server+":"+_scp.port+"/login/"+_scp.userName);
});

