
import {writeValue} from './memory';
import {pointerType} from './type';
import {PointerValue} from './value';

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
  const parentScope = state.scope;
  const kind = effect[1];
  const block = effect[2];
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: parentScope.limit,
    kind,
    block
  }
};

const applyLeaveEffect = function (state, effect) {
  let scope = state.scope;
  while (scope.block !== effect[1]) {
    scope = scope.parent;
    if (!scope) {
      console.log('stack underflow', state.scope, effect);
      throw 'stack underflow';
    }
  }
  state.scope = scope.parent;
};

const applyVardeclEffect = function (state, effect) {
  const parentScope = state.scope;
  const decl = effect[1];
  const address = parentScope.limit - decl.type.size;
  const ref = new PointerValue(pointerType(decl.type), address);
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: address,
    kind: 'vardecl',
    decl: decl,
    ref: ref
  };
  if (effect[2] !== null) {
    applyStoreEffect(state, ['store', ref, effect[2]]);
  }
};

const applyParamEffect = function (state, effect) {
  const parentScope = state.scope;
  const decl = effect[1];
  const address = parentScope.limit - decl.type.size;
  const ref = new PointerValue(pointerType(decl.type), address);
  state.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: address,
    kind: 'param',
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
  vardecl: applyVardeclEffect,
  param: applyParamEffect
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
