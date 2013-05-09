var scrabby = require('../bot.js');

scrabby.configure("http://myelinprice.com", 1337);

console.log(scrabby.gaddag);

var alsoDumb = function(state) {
        var loc = {x:7, y:7};
        var found = false;
        while(loc.x >= 0 && !found) {
            var space = state.board.squares[loc.x][loc.y];
            if(space.tileLocked) {
                loc.x--;
                continue;
            } else found = true;
        }

        var pieceToPlay;
        console.log('player '+state.players[scrabby.PLAYER_ID].name);
        var pSet = state.players[scrabby.PLAYER_ID].rack.squares;
        for(var piece in pSet) {
            if(pSet[piece].type !== "Normal") continue; // TODO handle blank tiles
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

        scrabby.makeMove({letter:pieceToPlay.tile.letter, x:loc.x, y:loc.y, blank:false});
    }


scrabby.strategy = alsoDumb;

scrabby.connect('ryan');
