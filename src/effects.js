
import {writeValue} from './memory';
import {pointerType} from './type';
import {PointerValue} from './value';
import {findClosestBlockScope, findClosestFunctionScope} from './scope';

const applyLoadEffect = function (state, effect) {
  // ['load', ref]
  const ref = effect[1];
  state.memoryLog = state.memoryLog.push(effect);
};

const applyStoreEffect = function (state, effect) {
  // ['store', ref, value]
  const ref = effect[1];
  const value = effect[2];
  state.memory = writeValue(state.memory, ref, value);
  state.memoryLog = state.memoryLog.push(effect);
};

const applyEnterEffect = function (state, effect) {
  // ['enter', blockNode]
  const parentScope = state.scope;
  const blockNode = effect[1];
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    kind: 'block',
    limit: parentScope.limit,
    blockNode
  }
};

const applyLeaveEffect = function (state, effect) {
  // ['leave', blockNode]
  const scope = findClosestBlockScope(state.scope, effect[1]);
  if (!scope) {
    console.log('stack underflow', state.scope, effect);
    throw new Error('stack underflow');
  }
  state.scope = scope.parent;
};

const applyCallEffect = function (state, effect) {
  // ['call', cont, [func, args...]]
  const parentScope = state.scope;
  const cont = effect[1];
  const values = effect[2];
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    kind: 'function',
    limit: parentScope.limit,
    cont,
    values
  };
};

const applyReturnEffect = function (state, effect) {
  // ['return', result]
  const scope = findClosestFunctionScope(state.scope);
  if (!scope) {
    console.log('stack underflow', state.scope, effect);
    throw new Error('stack underflow');
  }
  // Pop all scopes up to and including the function's scope.
  state.scope = scope.parent;
  // Transfer control to the caller's continuation,
  state.control = scope.cont;
  // passing the return value.
  state.result = effect[1];
  // Set direction to 'out' to indicate that a function was exited.
  state.direction = 'out';
};

const applyVardeclEffect = function (state, effect) {
  const parentScope = state.scope;
  const decl = effect[1];
  const address = parentScope.limit - decl.type.size;
  const ref = new PointerValue(pointerType(decl.type), address);
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    kind: 'vardecl',
    limit: address,
    decl: decl,
    ref: ref
  };
  if (effect[2] !== null) {
    applyStoreEffect(state, ['store', ref, effect[2]]);
  }
};

export const defaultEffects = {
  load: applyLoadEffect,
  store: applyStoreEffect,
  enter: applyEnterEffect,
  leave: applyLeaveEffect,
  call: applyCallEffect,
  return: applyReturnEffect,
  vardecl: applyVardeclEffect
};

// applyEffect applies an effect by shallowly mutating the passed state.
export const applyEffect = function (state, effect, options) {
  const {effectHandlers} = options;
  const handler = effectHandlers[effect[0]];
  if (typeof handler === 'function') {
    return handler(state, effect);
  } else {
    console.log('invalid handler', effect[0])
    return state;
  }
};
