var fs = require('fs');
//var wordArray = require('./words/3000-array.json').words;
var Gaddag = require('./gaddag/gaddag.js').Gaddag;
var log = require('./gaddag/util.js').log;

var gaddag = new Gaddag();
//var wordArray = ["A", "AT", "CAR", "CAT", "CARE", "CARREL", "DATE", "PRECEDE", "PRESTO", "RADIUS"];
//console.log(wordArray);
//gaddag.addAll(wordArray);

//console.log(gaddag.getJson());

/*
fs.writeFile("./3000-gaddag.json", gaddag.getJson(), function(err) {
    if(err) {
        console.log(err);
    } else {
        console.log("The file was saved!");
    }
}); 
*/

fs.readFile("./words/3000-gaddag.json", function(err, data) {
    if(err) {
        console.log(err);
    } else {
        var t = JSON.parse(data);
        Gaddag.prototype.setTrie(t);
        //console.log(gaddag.getJson());
        console.log("All words with E: " + gaddag.findWordsWithHook('e').join(', '));
        //console.log("All words with U that can be formed using S and T: " + gaddag.findWordsWithRackAndHook(['S', 'T'], 'U').join(', '));
    }
}); 
