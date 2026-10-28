// A required CommonJS module sees its own exports object as `this`, and the
// UMD test for a CommonJS host takes the module.exports branch.
const constructor = this.constructor;
const fallback = (this && this.missingHelper) || (function () {
  return function (value) { return value + 1; };
})();
const secondFallback = (this && this.anotherHelper) || function () { return "second"; };
console.log("initial exports:", typeof fallback, fallback(6), constructor === Object);
console.log(secondFallback());
const kind = typeof this;
let host = "global";
if (typeof module !== "undefined" && module.exports) host = "commonjs";
(function (root) {
  console.log("lib wrapper root:", typeof root, root ? "truthy" : "falsy");
})(this);
exports.describe = function () {
  return kind + " " + host;
};
