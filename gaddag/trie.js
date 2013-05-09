
function Trie() {

    var trie = {};

    this.removeAll = function() {
        delete trie;
        trie = {};
    }

    this.addAll = function (words) {
        for (var i = 0, l = words.length; i < l; i++) {
            this.add(words[i]);
        }

        return this;
    }

    this.add = function (word) {
        var letters = word.split(""),
            cur = trie;

        for (var j = 0; j < letters.length; j++) {
            var letter = letters[j], pos = cur[ letter ];

            if (pos == null) {
                cur = cur[ letter ] = j === letters.length - 1 ? 0 : {};

            } else if (pos === 0) {
                cur = cur[ letter ] = { $:0 };

            } else {
                cur = cur[ letter ];
            }
        }

        return this;
    }

    // Returns the JSON structure
    this.getTrie = function () {
        return trie;
    }
    
    this.setTrie = function (t) {
        trie = t;
    }

    // Prints all words contained in the Trie
    this.getWords = function () {

        // from John Resig's dump-trie.js

        var words = [];
        dig("", trie);
        return( words );

        function dig(word, cur) {
            for (var node in cur) {
                var val = cur[ node ];

                if (node === "$") {
                    words.push(word);

                } else if (val === 0) {
                    words.push(word + node);

                } else {
                    dig(word + node, val);
                }
            }
        }
    }

    this.getJson = function () {

        // Commented .replace(...) for debugging as I need the quotes to visualize JSON.
        var ret = JSON.stringify(trie); //.replace(/"/g, "");

        var reserved = [ "abstract", "boolean", "break", "byte", "case", "catch", "char", "class", "const",
            "continue", "debugger", "default", "delete", "do", "double", "else", "enum", "export", "extends",
            "false", "final", "finally", "float", "for", "function", "goto", "if", "implements", "import", "in",
            "instanceof", "int", "interface", "long", "native", "new", "null", "package", "private", "protected",
            "public", "return", "short", "static", "super", "switch", "synchronized", "this", "throw", "throws",
            "transient", "true", "try", "typeof", "var", "void", "volatile", "while", "with" ];

        for (var i = 0; i < reserved.length; i++) {
            ret = ret.replace(new RegExp("([{,])(" + reserved[i] + "):", "g"), "$1'$2':");
        }

        return(ret);
    }
}

// If not browser, assume nodejs
if (typeof browser === 'undefined')
    module.exports.Trie = Trie;

/*
// Test code
var t = new Trie();
t.addAll(["CAR", "CARE", "CARREL", "PRECEDE", "PRESTO", "RADIUS"]);
console.log("JSON string: " + t.getJson() + "\n");
console.log("Words: " + t.getWords().join(', '));
*/
