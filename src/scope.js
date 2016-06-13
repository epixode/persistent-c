
export const findClosestBlockScope = function (scope, node) {
  while (scope && scope.node !== node) {
    scope = scope.parent;
  }
  return scope;
};

export const findClosestFunctionScope = function (scope) {
  while (scope && scope.kind !== 'function') {
    scope = scope.parent;
  }
  return scope;
};

