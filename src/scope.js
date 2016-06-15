
export const findClosestBlockScope = function (scope, node) {
  while (scope && scope.blockNode !== node) {
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

export const findLocalDeclaration = function (scope, name) {
  while (scope) {
    if (scope.kind === 'function') {
      // Prevent searching outside of the function's scope.
      break;
    }
    if (scope.kind === 'variable' && scope.name === name) {
      // Return the PointerValue to the variable's memory location
      // (in the case of functions and builtins, the value itself is used
      //  as the reference).
      return scope.ref;
    }
    scope = scope.parent;
  }
  return undefined;
};
