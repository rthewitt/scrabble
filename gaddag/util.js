// Utility functions

// Array Remove - By John Resig (MIT Licensed)
// http://ejohn.org/blog/javascript-array-remove/
Array.prototype.remove = function(from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// http://www.shamasis.net/2009/09/fast-algorithm-to-find-unique-items-in-javascript-array/#comment-348025468
Array.prototype.unique = function(){
    return this.filter(function(s, i, a){ return i == a.lastIndexOf(s); });
}

/*
    message - Message to log.
    newline - If true, a new line is appended to the logged message. Default is true.
 */
function log(message, newline) {

    // for convenience, set default to true
    if(typeof newline === 'undefined')
        newline = true;

    // If not browser, assume nodejs
    if (typeof browser === 'undefined') {
        console.log(message + (newline ? "\n" : ""));
    } else {
        document.write(message + (newline ? "<br/><br/>" : ""));
    }
}


// If not browser, assume nodejs
if (typeof browser === 'undefined') {
    module.exports.log = log;
}
