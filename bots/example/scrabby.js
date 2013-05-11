var scrabby = require('../bot.js');

scrabby.configure("http://myelinprice.com", 1337);

scrabby.scores = [];

function sumWord(word) {
    // problematic words effectively dropped
    var sum = -999; 
    try {
        for(var i in word.split(''))
            if(typeof word[i] === 'string')
                sum += this.scores[word[i]];
    } catch(e) { } // console.log("Unable to sum word: "+word+ "\n"+e); }
    return sum;
}
var scoreComp = function(w1, w2) {
    return sumWord(w1) - sumWord(w2);
}

// Currently we cannot handle word bridging
scrabby.hasWordCollisions = function(board, square, iter) {
    console.log("Checking boundaries..." + 
        (iter.isPivotAtWordBoundary ? "Edge Case"+(iter.first ? "first" : "last") : "");

    function cSafe(check) {
        console.log('SUPEREXTRA '+!!check);
        var extra = check && !check.tileLocked;
        console.log('also '+extra);
        return !check || (check && !check.tileLocked);
    }

    // Do we need to worry about orthogonal direction?
    var edgeCase = (iter.startPivot && iter.first) || (iter.endPivot && iter.last);
    var B = board.squares, s = square; // worth the readability

    var safe = true;
    if(iter.direction === 'RIGHT') {
        if(!edgeCase) {
            if(B[s.x] && !cSafe(B[s.x][s.y-1]))
                safe = false;
            if(B[s.x] && !cSafe(B[s.x][s.y+1]))
                safe = false;
        }
        if(iter.first && !cSafe(B[s.x-1][s.y])) safe = false;
        if(iter.last && !cSafe(B[s.x+1][s.y])) safe = false;
        /*
        return (!edgeCase && ((B[s.x] && !cSafe(B[s.x][s.y-1])) || (B[s.x] && !cSafe(B[s.x][s.y+1]) )))
            || (iter.first && !cSafe(B[s.x-1][s.y]))
             || (iter.last && !cSafe(B[s.x+1][s.y])) ? false : true;
             */
    } else if(iter.direction === 'DOWN') {
        if(!edgeCase) {
            if(B[s.x-1] && !cSafe(B[s.x-1][s.y]))
                safe = false;
            if(B[s.x+1] && !cSafe(B[s.x+1][s.y]))
                safe = false;
        }
        if(iter.first && !cSafe(B[s.x][s.y-1])) safe = false;
        if(iter.last && !cSafe(B[s.x][s.y+1])) safe = false;
      }
      return !safe;
}

var highestWordStrategy = function(state) {
        var rack = this.me.rack;
        rack.letters = [];

        // temporary construct rack scores for convenience
        for(var s in rack.squares) {
            if(rack.squares[s].tile && rack.squares[s].tile.letter) {
                console.log("square had tile "+rack.squares[s].tile.letter);
                rack.letters.push(rack.squares[s].tile.letter);
                this.scores[rack.squares[s].tile.letter] = rack.squares[s].tile.score;
                if(rack.squares[s].tile.letter === ' ') rack.squares.splice(s,1); // blank is a handicap for now
            } else(console.log("square had no tile"));
        }

        // words that can be used, associative array LETTER -> array
        var pool = [];
        // nested for loop
        for(var x=0; x<this.BOARD_LENGTH; x++) {
            for(var y=0; y<this.BOARD_LENGTH; y++) {

                var space = state.board.squares[x][y];
                if(space.tileLocked && space.tile) { // has been played
                    console.log('Retrieving for words with anchor: '+space.tile.letter+'\nrack: '+rack.letters);
                    var words = pool[space.tile.letter] ? pool[space.tile.letter] :
                        this.gaddag.findWordsWithRackAndHook(rack.letters, space.tile.letter);
                    console.log('Number of words returned: '+words.length);
                     // TODO trim list by regex.  Future will require a union of regex for efficiency
                    for(var i=0; i<words.length; i++)  {
                        if(!pool[words[i]]) {
                            var intel = {};
                            intel.anchors = [];
                            pool[words[i]] = intel;
                        }
                        pool[words[i]].anchors.push(space); // save possible play location
                    }
                    pool[space.tile.letter] = words; // this letter has been inspected (will change when constraints are added)
                    for(var www=0;www<words.length;www++) 
                        pool.push(words[www]);
                }
            }
        }
        pool.sort(scoreComp);
        // Brute force attempt to play high scoring words
        var x = 0;
        var piecesToPlay;
        var attempted;
        while(!piecesToPlay && x<pool.length) {
            attempted = { word: pool[x] };
            var intel = pool[attempted.word];
            console.log("Pool length was: "+pool.length);
            console.log("Process for word: "+attempted.word);
            var localPieces = []; // saves a second loop
            for(var i=0; i<intel.anchors.length; i++) {
                var anchor = intel.anchors[i];
                console.log('Found anchor: '+anchor.tile.letter);
                // if enough space before and enough space after
                var letters = attempted.word.split('');
                var aLoc = letters.indexOf(anchor.tile.letter);
                attempted.endPivot = aLoc == letters.length-1;
                attempted.startPivot = aLoc == 0;
                attempted.isPivotAtWordBoundary = attempted.startPivot || attempted.endPivot;

                var diri = 0;
                while(!piecesToPlay && diri < this.DIRECTIONS.length) {
                    var blocked = false;
                    attempted.direction = this.DIRECTIONS[diri];
                    for(var z=-aLoc; z<attempted.word.length-aLoc; z++) {
        
                        attempted.first = z == -aLoc ? true : false;
                        attempted.last = z == (attempted.word.length-aLoc)-1 ? true : false;
                        
                        if(z != 0 || (z == 0 && attempted.isPivotAtWordBoundary)) {
                            var thisX=anchor.x, thisY = anchor.y+z;
                            if(thisX < 0 || thisY < 0 || thisX >= this.BOARD_LENGTH || thisY >= this.BOARD_LENGTH || 
                                    ( z!=0 && state.board.squares[thisX][thisY].tileLocked) || 
                                        this.hasWordCollisions(state.board, state.board.squares[thisX][thisY], attempted)) {
                                blocked = true;
                                localPieces = [];
                                break;
                            } else if(z!=0) localPieces.push({letter: letters[aLoc+z],x: thisX, y: thisY, blank: false});
                        } 
                    }
                    if(!blocked) {
                        piecesToPlay = localPieces;
                        break;
                    } else diri++;
                }
            }
            x++;
        }

        // We will want to pass if this is truly the case
        if(!piecesToPlay) {
            this.pass();
            return;
         }

        console.log("Attempting word: "+attempted.word);
        this.makeMove.apply(this, piecesToPlay);
    }


scrabby.strategy = highestWordStrategy;

scrabby.connect('ryan');
