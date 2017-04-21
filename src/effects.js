
import {writeValue} from './memory';
import {builtinTypes, pointerType, arrayType} from './type';
import {IntegralValue, PointerValue, ArrayValue, FunctionValue, BuiltinValue, zeroAtType} from './value';
import {findClosestBlockScope, findClosestFunctionScope} from './scope';

function applyLoadEffect (state, effect) {
  // ['load', ref]
  const {core} = state;
  const ref = effect[1];
  core.memoryLog = core.memoryLog.push(effect);
};

function applyStoreEffect (state, effect) {
  // ['store', ref, value]
  const {core} = state;
  const ref = effect[1];
  const value = effect[2];
  core.memory = writeValue(core.memory, ref, value);
  core.memoryLog = core.memoryLog.push(effect);
};

function applyEnterEffect (state, effect) {
  // ['enter', blockNode]
  const {core} = state;
  const parentScope = core.scope;
  const blockNode = effect[1];
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: parentScope.limit,
    kind: 'block',
    blockNode
  }
};

function applyLeaveEffect (state, effect) {
  // ['leave', blockNode]
  const {core} = state;
  const scope = findClosestBlockScope(core.scope, effect[1]);
  if (!scope) {
    console.log('stack underflow', core.scope, effect);
    throw new Error('stack underflow');
  }
  core.scope = scope.parent;
};

function applyCallEffect (state, effect) {
  // ['call', cont, [func, args...]]
  const {core} = state;
  const parentScope = core.scope;
  const cont = effect[1];
  const values = effect[2];
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: parentScope.limit,
    kind: 'function',
    cont,
    values
  };
};

function applyReturnEffect (state, effect) {
  // ['return', result]
  console.log('return', effect);
  const {core} = state;
  const result = effect[1];
  const scope = findClosestFunctionScope(core.scope);
  if (!scope) {
    console.log('stack underflow', core.scope, effect);
    throw new Error('stack underflow');
  }
  // Pop all scopes up to and including the function's scope.
  core.scope = scope.parent;
  // Transfer control to the caller's continuation…
  core.control = scope.cont;
  // passing the return value to the caller (handling the special case for
  // control leaving the 'main' function without a return statement, where
  // C99 defines the result as being 0).
  if (!result && scope.cont.values[0].name === 'main') {
    core.result = new IntegralValue(builtinTypes['int'], 0);
  } else {
    core.result = result;
  }
  // Set direction to 'out' to indicate that a function was exited.
  core.direction = 'out';
};

function applyVardeclEffect (state, effect) {
  // ['vardecl', name, type, init]
  const {core} = state;
  const parentScope = core.scope;
  const name = effect[1];
  const type = effect[2];
  const refType = pointerType(type);
  const init = effect[3];
  let limit = parentScope.limit;
  let ref, doInit = !!init;
  if (doInit) {
    if (type.kind === 'array' && init.type.kind === 'pointer') {
      // When an array variable is initialized with a ref (as opposed to an
      // array value), no stack allocation or initialization occurs.
      ref = new PointerValue(refType, init.address);
      doInit = false;
    }
  }
  if (!ref) {
    // Allocate memory on stack and build a ref to that location.
    limit -= type.size;
    ref = new PointerValue(refType, limit);
  }
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: limit,
    kind: 'variable',
    name, type, ref
  };
  if (doInit) {
    applyStoreEffect(state, ['store', ref, init]);
  }
};

function declareGlobalVar (state, effect) {
  const {core} = state;
  const name = effect[1];
  const type = effect[2];
  const init = effect[3];
  const address = core.heapStart;
  core.heapStart += type.size;  // XXX add alignment padding
  const ref = new PointerValue(pointerType(type), address);
  core.memory = writeValue(core.memory, ref, init);
  core.globalMap[name] = ref;
}

function declareRecord (state, effect) {
  const {core} = state;
  const name = effect[1];
  const type = effect[2];
  core.recordDecls[name] = type;
}

function declareFunction (state, effect) {
  const {core, builtins} = state;
  const name = effect[1];
  const {decl, type, body} = effect[2];
  if (body) {
    const codePtr = core.functions.length;
    const value = new FunctionValue(type, codePtr, name, decl, body);
    core.functions.push(value);
    core.globalMap[name] = value;
  } else if (typeof builtins[name] === 'function') {
    const func = builtins[name];
    const codePtr = core.functions.length;
    const value = new BuiltinValue(type, codePtr, name, func);
    core.functions.push(value);
    core.globalMap[name] = value;
  }
}

export const defaultEffectHandlers = {
  load: applyLoadEffect,
  store: applyStoreEffect,
  enter: applyEnterEffect,
  leave: applyLeaveEffect,
  call: applyCallEffect,
  return: applyReturnEffect,
  vardecl: applyVardeclEffect
};

export const declEffectHandlers = {
  vardecl: declareGlobalVar,
  recdecl: declareRecord,
  fundecl: declareFunction
};
