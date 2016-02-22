
import {sizeOfType} from './type';
import {getStep} from './step';

export const start = function (context) {
  const {decls, builtins} = context;

  // Built the map of global variables.
  // The 'main' function is detected and currentNode is set to the body
  // of that function.
  let currentNode = null;
  const globalMap = {};
  decls.forEach(function (node) {
    if (node[0] === 'FunctionDecl') {
      const name = node[2][0][1].identifier;
      // TODO: evaluate the types!
      if (builtins && name in builtins) {
        globalMap[name] = {name, type: ['function'], ref: ['builtin', builtins[name]]};
      } else {
        globalMap[name] = {name, type: ['function'], ref: ['function', node]};
      }
    }
  });

  // Initialize the memory, control, and scope data structures.
  const memory = {start: 0, limit: 0x10000, fill: 0};
  const control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0
  };
  const scope = {key: 0, limit: memory.limit};
  const state = {globalMap, memory, control, scope};

  // Use stepInto to descend into the first statement of the main function.
  return stepInto(state, {continue: false});
};

export const stepMicro = function (state, options) {
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
      if (effect[0] === 'store') {
        const ref = effect[1];
        const value = effect[2];
        if (ref[0] === 'pointer') {
          const address = ref[1];
          newState.memory = {parent: newState.memory, address, value};
        } else {
          console.log('cannot write through reference', ref, value);
        }
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
        const address = parentScope.limit - sizeOfType(decl.type);
        const ref = ['pointer', address];
        newState.scope = {
          parent: parentScope,
          key: parentScope.key + 1,
          limit: address,
          kind: 'vardecl',
          decl: {...decl, ref}
        };
        if (effect[2] !== null) {
          newState.memory = {parent: newState.memory, address, value: effect[2]};
        }
      } else if (effect[0] === 'param') {
        const parentScope = newState.scope;
        const decl = effect[1];
        const address = parentScope.limit - sizeOfType(decl.type);  // XXX array
        const ref = ['pointer', address];
        newState.scope = {
          parent: parentScope,
          key: parentScope.key + 1,
          limit: address,
          kind: 'param',
          decl: {...decl, ref}
        };
        if (effect[2] !== null) {
          newState.memory = {parent: newState.memory, address, value: effect[2]};
        }
      } else {
        options.onEffect(effect);
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

export const stepExpr = function (state, options) {
  // Execute micro-steps until we cross any (stmt, expr) boundary, going down.
  do {
    const prevState = state;
    state = stepMicro(prevState, options);
    if (state === prevState || !state.control || state.error)
      return state;
    // TODO: keep going if the expression is trivial (literal, var. ref.)
  } while (state.direction === 'up' || !state.control.seq);
  return state;
};

export const stepInto = function (state, options) {
  if (options.continue) {
    // Execute micro-steps until we cross a statement boundary, going down.
    do {
      const prevState = state;
      state = stepMicro(prevState, options);
      if (state === prevState || !state.control || state.error)
        return state;
    } while (state.direction === 'up' || state.control.seq !== 'stmt');
  }
  // Go down as much as possible into compound statements.
  while (state.direction === 'down' && /^(CompoundStmt|IfStmt|WhileStmt|DoStmt|ForStmt)$/.test(state.control.node[0])) {
    const prevState = state;
    state = stepMicro(prevState, options);
    if (state === prevState || !state.control || state.error)
      return state;
  }
  return state;
};

export const stepOut = function (state, options) {
  let scope = state.scope;
  while (scope.kind !== 'function') {
    scope = scope.parent;
    if (!scope)
      return state;
  }
  scope = scope.parent;
  do {
    const prevState = state;
    state = stepMicro(prevState, options);
    if (state === prevState || !state.control || state.error)
      return state;
  } while (state.scope !== scope);
  return state;
};

export const run = function (state, options) {
  while (state.control) {
    const prevState = state;
    state = stepMicro(prevState, options);
    if (state === prevState || state.error)
      return state;
  }
  return state;
};

export const stepOver = function (state) {
  // TODO
  return state;
};
