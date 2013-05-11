// requires trie.js and util.js

// TODO: Handle no hook case - just use first function?
//          or maybe make each rack letter a hook and call recursive function

// If not browser, assume nodejs
if (typeof browser === 'undefined') {
    var Trie = require('./trie.js').Trie;
    require('./util.js');
}

function Gaddag() {

    var separator = ">";

    this.add = function (word) {

        if (word.length === 0) return;

        for (var i = 1; i < word.length; i++) {
            var prefix, ch;

            prefix = word.substring(0, i);
            ch = prefix.split('');
            ch.reverse();
            Gaddag.prototype.add(ch.join('') + separator + word.substring(i));
        }

        ch = word.split('');
        ch.reverse();
        Gaddag.prototype.add(ch.join('') + separator + word.substring(i));
    };

    this.findWordsWithHook = function (hook) {
        var trie = Gaddag.prototype.getTrie();
        var starterNode = trie[hook];
        var words = [];

        if (typeof starterNode === 'undefined') return;

        dig(hook, starterNode, 'reverse');
        return words;

        function dig(word, cur, direction) {
            for (var node in cur) {
                var val = cur[ node ],
                    ch = (node === separator || node === "$" ? '' : node);

                if (val === 0) {
                    words.push(word + ch);

                } else {
                    // nodes after this form the suffix
                    if (node === separator) direction = 'forward';

                    var part = (direction === 'reverse' ? ch + word : word + ch);
                    dig(part, val, direction);

                }

                // done with the previous subtree, reset direction to indicate we are in the prefix part of next subtree
                if (node === separator) direction = 'reverse';
            }
        }
    }

    this.findWordsWithRackAndHook = function (rack, hook) {
        var trie = Gaddag.prototype.getTrie();
        var words = [];

        /* To avoid recursing down duplicate characters more than once, sort the array and check whether we have already
         processed a letter before descending the subtree.
         */
        rack.sort();

        if (hook === '') {
            /*
                Each character in the rack acts as a hook with the remaining characters as the new rack.
            */

            while(rack.length > 1) {
                var h = rack.shift();
                findWordsRecurse("", rack, h, trie, 'reverse');
            }
        }
        else {
            findWordsRecurse("", rack, hook, trie, 'reverse');
        }

        return words.unique();

        function findWordsRecurse(word, rack, hook, cur, direction) {
            var hookNode = cur[ hook ];

            if (typeof hookNode === 'undefined') return;

            var hookCh = (hook === separator || hook === "$" ? '' : hook);
            word = (direction === "reverse" ? hookCh + word : word + hookCh);

            for (var nodeKey in hookNode) {
                var nodeVal = hookNode[ nodeKey ];
                var nodeCh = (nodeKey === separator || nodeKey === "$" ? '' : nodeKey);

                // if we have reached the end of this subtree, add the word (+ last character) to output array
                if (nodeVal === 0) {
                    // BUGFIX FROM BLOG - RTH
                    if(nodeCh != '' && rack.indexOf(nodeCh) === -1) {
                        continue;
                    }
                    else {
                        words.push(word + nodeCh);
                    }
                } else {
                    // if this is the character separating the prefix, change direction and continue recursing
                    if (nodeKey === separator) {
                        findWordsRecurse(word, rack, separator, hookNode, 'forward');
                    }
                    else {
                        // descend down the next subtree that is rooted at any letter in the rack (which is not a duplicate)
                        processRack(word, rack, nodeKey, hookNode, direction);
                    }
                }
            }
        }

        function processRack(word, rack, nodeKey, hookNode, direction) {
            for (var i = 0; i < rack.length; i++) {
                if (nodeKey === rack[i]) {
                    var duplicate = (i > 0 ? (rack[i] === rack[i - 1] ? true : false) : false);
                    if (!duplicate) {
                        var newRack = rack.slice(0);
                        newRack.remove(i);
                        findWordsRecurse(word, newRack, nodeKey, hookNode, direction);
                    }
                }
            }
        }
    }
}

// Inherit from Trie
Gaddag.prototype = new Trie();

// If not browser, assume nodejs
if (typeof browser === 'undefined')
    module.exports.Gaddag = Gaddag;
