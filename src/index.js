
import Immutable from 'immutable';

import {scalarTypes, pointerType} from './type';
import {PointerValue, stringValue, BuiltinValue, FunctionValue} from './value';
import {allocate, readValue, writeValue, readString} from './memory';
import {getStep} from './step';
import {applyEffect} from './effects';
import {finalizeVarDecl} from './decl';

export {functionType, pointerType, arrayType, decayedType, scalarTypes} from './type';
export {
  IntegralValue, FloatingValue, PointerValue, stringValue,
  BuiltinValue, FunctionValue, makeRef} from './value';
export {readValue, writeValue, readString} from './memory';
export {getStep} from './step';
export {findClosestFunctionScope} from './scope';
export {defaultEffects} from './effects';

export const start = function (context) {
  const {decls, builtins, options} = context;
  const core = initCore(0x10000);

  // Built the map of global variables.
  // const intFunc = functionType(scalarTypes['int'], []);
  decls.forEach(function (declNode) {

    // Copy string literals to memory.
    forEachNode(declNode, function (node) {
      if (node[0] === 'StringLiteral') {
        const value = stringValue(node[1].value);
        const ref = new PointerValue(value.type, core.heapStart);
        core.memory = writeValue(core.memory, ref, value);
        core.heapStart += value.type.size;
        node[1].ref = ref;
      }
    });

    // Add the declaration to the global map.
    switch (declNode[0]) {
      case 'VarDecl': {
        const name = declNode[1].name;
        // Evaluate type and initializer.
        const typeNode = declNode[2][0];
        const preType = stepThroughNode(core, typeNode, options);
        const initNode = declNode[2][1];
        const preInit = initNode && stepThroughNode(core, initNode, options);
        const {type, init} = finalizeVarDecl(preType, preInit);
        // Allocate and initialize memory.
        const address = core.heapStart;
        core.heapStart += type.size;  // XXX add alignment padding
        const ref = new PointerValue(pointerType(type), address);
        core.memory = writeValue(core.memory, ref, init);
        core.globalMap[name] = ref;
        break;
      }
      case 'FunctionDecl': {
        const name = declNode[2][0][1].identifier;
        if (builtins && name in builtins) {
          core.globalMap[name] = new BuiltinValue(name, builtins[name]);
        } else {
          core.globalMap[name] = new FunctionValue(declNode);
        }
        break;
      }
    }
  });

  // TODO: pass argc, argv to 'main'
  core.control = {
    node:
      ['CallExpr', {}, [
        ['DeclRefExpr', {}, [
          ['Name', {identifier: 'main'}, []]]]]],
    step: 0,
    cont: null
  };

  return {core, options};
};

const initCore = function (memorySize) {
  const globalMap = {};
  const scope = {key: 0, limit: memorySize};
  const memory = allocate(memorySize);
  const heapStart = 0x100;
  return {globalMap, scope, memory, heapStart};
};

export const applyStep = function (state, step) {
  // Make fresh objects that can be imperatively updated during the step.
  const newCore = {...state.core};
  const newState = {...state, core: newCore};
  const effects = step.effects || [];
  // Update the control structure, handling the special 'return' continuation.
  newCore.control = step.control;
  if (step.control === 'return') {
    // Transfering control to 'return' appends a 'return' effect, which avoids
    // having a dummy return node to handle execution falling through the end
    // of a block.
    effects.push(['return', step.result]);
  } else {
    // Normal control transfer copies the step's result if present, and sets
    // the direction accordingly.
    if ('result' in step) {
      newCore.result = step.result;
      newCore.direction = 'up';
    } else {
      newCore.result = undefined;
      newCore.direction = 'down';
    }
  }
  // Perform the side-effects.
  effects.forEach(function (effect) {
    applyEffect(newState, effect);
  });
  return newState;
};

export const clearMemoryLog = function (core) {
  return {...core, memoryLog: Immutable.List(), oldMemory: core.memory};
};

export const step = function (state) {
  // Performs a single step.
  if (!state.core.control) {
    // Program is halted.
    return state;
  }
  const step = getStep(state.core);
  if ('error' in step) {
    // Evaluation cannot proceed due to an error.
    return {...state, error: step.error};
  }
  // Apply the effects.
  return applyStep(state, step);
};

const stepThroughNode = function (core, node, options) {
  let state = {core: {...core, control: {node, step: 0}}, options};
  while (state.core.control) {
    const step = getStep(state.core);
    if ('error' in step) {
      throw new Error(step.error);
    }
    state = applyStep(state, step);
  }
  return state.core.result;
};

const forEachNode = function (node, callback) {
  const queue = [[node]];
  while (queue.length !== 0) {
    queue.pop().forEach(function (node) {
      callback(node);
      if (node[2].length !== 0) {
        queue.push(node[2]);
      }
    });
  }
};

export const outOfCurrentStmt = function (core) {
  if (core.control.return)
    return true;
  return /down|out/.test(core.direction) && core.control.seq === 'stmt';
};

export const intoNextStmt = function (core) {
  return !/^(CompoundStmt|IfStmt|WhileStmt|DoStmt|ForStmt)$/.test(core.control.node[0]);
};

export const intoNextExpr = function (core) {
  return /down|out/.test(core.direction) && core.control.seq;
};

export const notInNestedCall = function (scope, refScope) {
  while (scope.key >= refScope.key) {
    if (scope.kind === 'function') {
      return false;
    }
    scope = scope.parent;
  }
  return true;
};
