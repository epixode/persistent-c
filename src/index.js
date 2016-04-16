
// import {functionType, pointerType, scalarTypes} from './type';
import {allocate, writeValue} from './memory';
import {getStep} from './step';
import {pointerType} from './type';
import {PointerValue} from './value';

export {readValue} from './memory';

export const start = function (context) {
  const {decls, builtins} = context;

  // Built the map of global variables.
  // The 'main' function is detected and currentNode is set to the body
  // of that function.
  let currentNode = null;
  const globalMap = {};
  // const intFunc = functionType(scalarTypes['int'], []);
  decls.forEach(function (node) {
    if (node[0] === 'FunctionDecl') {
      const name = node[2][0][1].identifier;
      // XXX: evaluate the types!
      if (builtins && name in builtins) {
        globalMap[name] = {name, value: ['builtin', builtins[name]]};
      } else {
        globalMap[name] = {name, value: ['function', node]};
      }
    }
  });

  // Initialize the memory, control, and scope data structures.
  const limit = 0x10000;
  const memory = allocate(limit);
  const control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0
  };
  const scope = {key: 0, limit: limit};
  const state = {globalMap, memory, control, scope};

  return state;
};

export const step = function (state, options) {
  // End of program?
  if (!state.control)
    return state;
  let newState = {...state}, direction;
  const step = getStep(newState, newState.control);
  newState.control = step.control;
  if ('error' in step) {
    newState.error = step.error;
  } else {
    newState.error = undefined;
  }
  if ('effects' in step) {
    // Perform the side-effects.
    step.effects.forEach(function (effect) {
      console.log('effect', effect);
      if (effect[0] === 'store') {
        // ['store', {type, address}, value]
        const ref = effect[1];
        const value = effect[2];
        newState.memory = writeValue(newState.memory, ref, value);
      } else if (effect[0] === 'enter') {
        const parentScope = newState.scope;
        const kind = effect[1];
        const block = effect[2];
        newState.scope = {
          parent: parentScope,
          key: parentScope.key + 1,
          limit: parentScope.limit,
          kind,
          block
        }
      } else if (effect[0] === 'leave') {
        let scope = newState.scope;
        while (scope.block !== effect[1]) {
          scope = scope.parent;
          if (!scope) {
            console.log('stack underflow', newState.scope, effect);
            throw 'stack underflow';
          }
        }
        newState.scope = scope.parent;
      } else if (effect[0] === 'vardecl') {
        const parentScope = newState.scope;
        const decl = effect[1];
        const address = parentScope.limit - decl.type.size;
        const ref = new PointerValue(pointerType(decl.type), address);
        newState.scope = {
          parent: parentScope,
          key: parentScope.key + 1,
          limit: address,
          kind: 'vardecl',
          decl: decl,
          ref: ref
        };
        if (effect[2] !== null) {
          newState.memory = writeValue(newState.memory, ref, effect[2]);
        }
      } else if (effect[0] === 'param') {
        const parentScope = newState.scope;
        const decl = effect[1];
        const address = parentScope.limit - decl.type.size;
        const ref = new PointerValue(pointerType(decl.type), address);
        newState.scope = {
          parent: parentScope,
          key: parentScope.key + 1,
          limit: address,
          kind: 'param',
          decl: decl,
          ref: ref
        };
        if (effect[2] !== null) {
          newState.memory = writeValue(newState.memory, ref, effect[2]);
        }
      } else {
        newState = options.onEffect(newState, effect);
      }
    });
  }
  if ('result' in step) {
    newState.result = step.result;
    newState.direction = 'up';
    // TODO: attach the result to the node for visualisation.
  } else {
    newState.result = undefined;
    newState.direction = 'down';
  }
  return newState;
};

export const outOfCurrentStmt = function (state) {
  return state.direction === 'down' && state.control.seq === 'stmt';
};

export const intoNextStmt = function (state) {
  return !/^(CompoundStmt|IfStmt|WhileStmt|DoStmt|ForStmt)$/.test(state.control.node[0]);
};

export const intoNextExpr = function (state) {
  return state.direction === 'down' && state.control.seq;
};
