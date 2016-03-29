/*

Sequence points are marked in reduction steps by returning an object
with the seq property set to true.  In C, sequence points occur:
  - after evaluating the left operand of '&&', '||', ','
  - after evaluating cond in (cond '?' ift ':' iff)
  - at the end a full expression, that is:
    - after evaluating each compound statement
    - after a return statement
    - controlling expressions of if, switch, while, do/while, for
    - before entering a function in a call
    - after each initializer

*/

import {
  integerValue, unboxAsInteger,
  evalUnaryOperation, evalBinaryOperation, evalCast} from './value';
import {sizeOfType} from './type';

const one = integerValue(1);

const findDeclaration = function (state, name) {
  // Search in the local scope.
  let scope = state.scope;
  while (scope) {
    const {decl} = scope;
    if (decl && decl.name === name) {
      return decl;
    }
    if (scope.kind === 'function') {
      // Prevent searching outside of the function's scope.
      break;
    }
    scope = scope.parent;
  }
  // Search in the global declarations.
  if (name in state.globalMap) {
    return state.globalMap[name];
  }
  console.log('findDeclaration error', state, name);
  throw 'findDeclaration error';
};

const sizeOfExpr = function (state, node) {
  switch (node[0]) {
    case 'ParenExpr':
      return sizeOfExpr(state, node[2][0]);
    case 'DeclRefExpr':
      {
        const name = node[2][0];
        const decl = findDeclaration(state, name[1].identifier);
        return decl.size;
      }
    default:
      alert ('sizeof expr ' + node[0]);
      return 0;
  }
};

const deref = function (state, ref, ty) {

  if (ref === undefined) {
    alert('dereferenced undefined pointer');
    return undefined;
  }

  // A reference to a builtin or a user function evaluates to itself.
  if (ref[0] === 'builtin' || ref[0] === 'function')
    return ref;

  if (ref[0] === 'pointer') {
    const address = ref[1];
    // XXX read at type ty
    let memory = state.memory;
    while (memory) {
      if (memory.address === address) {
        return memory.value;
      }
      memory = memory.parent;
    }
  }

  return 0;
};

const enter = function (node, cont, attrs) {
  return {node, step: 0, cont, ...attrs};
};

const enterExpr = function (node, cont, attrs) {
  return {node, step: 0, cont, seq: 'expr', ...attrs};
};

const enterStmt = function (node, cont, attrs) {
  return {node, step: 0, cont, seq: 'stmt', ...attrs};
};

const stepCompoundStmt = function (state, control) {
  const {node, step} = control;

  // When leaving the block, the declaration's frame is discarded.
  if (step >= node[2].length) {
    return {
      result: null, control: control.cont,
      effects: [['leave', node]],
    };
  }

  // Set up a continuation and pass control to the next child.
  const cont = {...control, step: step + 1};
  const result = {control: enterStmt(node[2][step], cont)};

  // Set up a frame for the block's declarations when entering the block.
  if (step === 0) {
    result.effects = [['enter', 'block', node]]
  }

  return result;
};

const stepDeclStmt = function (state, control) {
  const {node, step} = control;
  if (step < node[2].length) {
    // Pass control to the next child, setting up the continuation
    // for the next step.
    return {
      control: enter(node[2][step], {...control, step: step + 1})
    };
  }
  // No next child: return void and pass control to the continuation.
  return {control: control.cont, result: null};
};

const stepParenExpr = function (state, control) {
  if (control.step === 0) {
    // ParenExpr is transparent w.r.t. the evaluation mode (value/lvalue).
    return {
      control: enter(
        control.node[2][0], {...control, step: 1}, {mode: control.mode})
    };
  } else {
    const result = state.result;
    return {control: control.cont, result};
  }
};

const stepForStmt = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter init, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // enter cond, continue w/ step 3
    return {control: enterStmt(node[2][1], {...control, step: 3})};
  }
  if (step === 2) {
    // enter update, continue w/ step 1
    return {control: enterStmt(node[2][2], {...control, step: 1})};
  }
  if (step === 3) {
    // result ? (enter body, continue w/ step 2) : leave
    if (0 !== unboxAsInteger(state.result)) {
      return {control: enterStmt(node[2][3], {...control, step: 2, break: 4})};
    }
  }
  return {control: control.cont, result: null};
};

const stepWhileStmt = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter cond, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // result ? (enter body, continue w/ step 0) : leave
    if (0 !== unboxAsInteger(state.result)) {
      return {control: enterStmt(node[2][1], {...control, step: 0, break: 2})};
    }
  }
  return {control: control.cont, result: null};
};

const stepDoStmt = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    // enter body, continue w/ step 1
    return {control: enterStmt(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    // enter cond, continue w/ step 2
    return {control: enterStmt(node[2][1], {...control, step: 2})};
  }
  if (step === 2) {
    // result ? (enter body, continue w/ step 1) : leave
    if (0 !== unboxAsInteger(state.result)) {
      const cont = {...control, step: 1, break: 3};
      return {control: enterStmt(node[2][0], cont)};
    }
  }
  return {control: control.cont, result: null};
};

const stepBreakStmt = function (state, control) {
  let cont = control;
  do {
    cont = cont.cont;
  } while (!('break' in cont));
  return {control: {...cont, step: cont.break, seq: 'stmt'}, result: null};
};

const stepContinueStmt = function (state, control) {
  let cont = control;
  do {
    cont = cont.cont;
  } while (!('break' in cont));
  return {control: {...cont, seq: 'stmt'}, result: null};
};

const stepIfStmt = function (state, control) {
  const {node, step} = control;
  switch (step) {
  case 0:
    // No 'statement' boundary around the condition.
    return {control: enterExpr(node[2][0], {...control, step: 1})};
  case 1:
    if (0 !== unboxAsInteger(state.result)) {
      return {control: enterStmt(node[2][1], {...control, step: 2})};
    } else {
      if (node[2].length === 3)
        return {control: enterStmt(node[2][2], {...control, step: 2})};
      else
        return {control: control.cont, result: null};
    }
  case 2:
    return {control: control.cont, result: null};
  }
};

const stepReturnStmt = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enterExpr(node[2][0], {...control, step: 1})};
  }
  let cont = control;
  do {
    cont = cont.cont;
  } while (!('return' in cont));
  return {control: cont, result: state.result};
};

const stepCallExpr = function (state, control) {
  const {node, step} = control;
  // Numeric steps accumulate the results of evaluating each child expression.
  let values = control.values;
  if (typeof step === 'number') {
    if (step === 0) {
      values = [];
    } else {
      values = values.slice();
      values.push(state.result);
    }
    if (step < node[2].length) {
      // Pass control to the next child, setting up the continuation
      // for the next step.
      return {
        control: enterExpr(node[2][step], {...control, step: step + 1, values})
      };
    }
    const funcVal = values[0];
    // All arguments have been evaluated, perform the call.
    if (funcVal[0] === 'builtin') {
      // A builtin function handles the rest of the call step.
      return funcVal[1](state, control.cont, values);
    }
    if (funcVal[0] === 'function') {
      // A user-defined function holds the FunctionDecl node.
      const funcNode = funcVal[1];
      const funcTypeNode = funcNode[2][1];
      return {
        control: enter(funcTypeNode, {...control, step: 'F', values}),
        effects: [['enter', 'function', funcNode]]
      };
    }
    console.log('call error', funcVal);
    throw 'call error';
  }
  const funcVal = values[0];
  if (step === 'F') {
    // The F step uses the evaluated type of the callee to set up the values of
    // its formal parameters in its scope.
    const funcNode = funcVal[1];
    const funcType = state.result;
    const effects = [];
    const params = funcType[2];
    for (let i = 0; i < params.length; i++) {
      effects.push(['param', params[i], values[i + 1]]);
    }
    return {
      effects,
      control: enterStmt(funcNode[2][2], {...control, return: true, step: 'R'})
    };
  }
  if (step === 'R') {
    // The R step catches the callee's result and exits the callee's scope.
    const funcNode = funcVal[1];
    return {
      effects: [['leave', funcNode]],
      control: control.cont,
      result: state.result
    };
  }
};

const stepImplicitCastExpr = function (state, control) {
  const {step, node} = control;
  if (step === 0) {
    // An implicit cast is transparent w.r.t. the value/lvalue mode.
    return {
      control: enter(node[2][0], {...control, step: 1}, {mode: control.mode})
    };
  }
  if (step === 1) {
    // No expression boundary around the expression of an implicit cast.
    return {
      control: enter(node[2][1], {...control, step: 2, value: state.result})
    };
  }
  const value = control.value;
  const type = state.result;
  const result = evalCast(type, value);
  return {control: control.cont, result};
};

const stepDeclRefExpr = function (state, control) {
  const name = control.node[2][0];
  const decl = findDeclaration(state, name[1].identifier);
  let result;
  if (control.mode === 'lvalue' || /^(array|function)$/.test(decl.type[0])) {
    result = decl.ref
  } else {
    result = deref(state, decl.ref, decl.type);
  }
  return {control: control.cont, result};
};

const stepUnaryOperator = function (state, control) {
  if (control.step === 0) {
    // Evaluate the operand.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else {
    const value = state.result;
    const result = evalUnaryOperation(control.node[1].opcode, value);
    return {control: control.cont, result};
  }
};

const stepAssignmentUnaryOperator = function (state, control) {
  if (control.step === 0) {
    // Evaluate the operand as a lvalue.
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else {
    const lvalue = state.result;
    const oldValue = deref(state, lvalue);
    const opcode = control.node[1].opcode;
    const binOp = /Inc$/.test(opcode) ? 'Add' : 'Sub';
    const newValue = evalBinaryOperation(binOp, oldValue, one);
    const result = /^Pre/.test(opcode) ? newValue : oldValue;
    return {
      control: control.cont,
      effects: [['store', lvalue, newValue]],
      result
    };
  }
};

const stepAddrOf = function (state, control) {
  if (control.step === 0) {
    // Evaluate the operand as an lvalue.
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else {
    // Pass the result.
    const result = state.result;
    return {control: control.cont, result};
  }
};

const stepDeref = function (state, control) {
  if (control.step === 0) {
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else {
    // Pass the result.
    const lvalue = state.result;
    // As an lvalue (*a) reduces to a.
    const result = (control.mode === 'lvalue') ? lvalue : deref(state, lvalue);
    return {control: control.cont, result};
  }
};

const stepUnaryExprOrTypeTraitExpr = function (state, control) {
  // In C, this node kind is always sizeof.
  // TODO: include the type of the expression in the AST, so we can
  //       simply call sizeOfType.
  const result = integerValue(sizeOfExpr(state, control.node[2][0]));
  return {control: control.cont, result};
};

const stepBinaryOperator = function (state, control) {
  if (control.step === 0) {
    // Before LHS.
    return {
      control: enterExpr(control.node[2][0], {...control, step: 1})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lhs = state.result;
    const opcode = control.node[1].opcode;
    // Short-circuit evaluation for logical operators.
    if ((opcode === 'LAnd' && 0 === unboxAsInteger(lhs)) ||
        (opcode === 'LOr' && 0 !== unboxAsInteger(lhs)))
      return {control: control.cont, result: lhs};
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lhs})
    };
  } else {
    // After RHS.
    const rhs = state.result;
    const opcode = control.node[1].opcode;
    const result =
      /^(Comma|LOr|LAnd)$/.test(opcode) ? rhs : evalBinaryOperation(opcode, control.lhs, rhs);
    return {control: control.cont, result};
  }
};

const stepAssignmentOperator = function (state, control) {
  if (control.step === 0) {
    // Before LHS (as lvalue).
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lvalue = state.result;
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lvalue})
    };
  } else {
    // After RHS.
    const lvalue = control.lvalue;
    const {result} = state;
    const effects = [['store', lvalue, result]];
    return {control: control.cont, result, effects};
  }
};

const stepAssignmentBinaryOperator = function (state, control) {
  if (control.step === 0) {
    // Before LHS (as lvalue).
    return {
      control: enterExpr(
        control.node[2][0], {...control, step: 1}, {mode: 'lvalue'})
    };
  } else if (control.step === 1) {
    // After LHS, before RHS.
    const lvalue = state.result;
    const lhs = deref(state, lvalue);
    return {
      control: enterExpr(control.node[2][1], {...control, step: 2, lvalue, lhs})
    };
  } else {
    // After RHS.
    const {lvalue, lhs} = control;
    const rhs = state.result;
    const opcode = control.node[1].opcode.replace('Assign', '');
    const result = evalBinaryOperation(opcode, lhs, rhs);
    const effects = [['store', lvalue, result]];
    return {control: control.cont, result, effects};
  }
};

const stepCStyleCastExpr = function (state, control) {
  // TODO: implement stepCStyleCastExpr; children are [expr, type].
  return {control, error: 'cast is not implemented yet'};
};

const stepArraySubscriptExpr = function (state, control) {
  return {control, error: 'array subscript is not implemented yet'};
};

const stepVarDecl = function (state, control) {
  // VarDecl children are [type, init?] (init is optional).
  const {step, node} = control;
  // The type is evaluated in case it contains expressions,
  // as for instance in the case of ConstantArrayType.
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  // Evaluate the inializer, if present.
  if (step === 1 && node[2].length === 2) {
    const type = state.result;
    return {control: enterExpr(node[2][1], {...control, step: 2, type})};
  }
  const {name} = control.node[1];
  const type = step === 1 ? state.result : control.type;
  const size = sizeOfType(type);
  const init = step === 2 ? state.result : null;
  const effects = [['vardecl', {name, type, size}, init]];
  return {control: control.cont, result: null, effects};
};

const stepIntegerLiteral = function (state, control) {
  const number = parseInt(control.node[1].value);  // XXX somewhat incorrect?
  return {
    control: control.cont,
    result: integerValue(number)
  };
};

const stepCharacterLiteral = function (state, control) {
  const char = control.node[1].value;
  return {
    control: control.cont,
    result: integerValue(char)
  };
};

const stepFloatingLiteral = function (state, control) {
  const number = parseFloat(control.node[1].value);
  return {
    control: control.cont,
    result: floatingValue(number)
  };
};

const stepStringLiteral = function (state, control) {
  const value = control.node[1].value;
  return {
    control: control.cont,
    result: ['string', value]  // TODO: convert to heap address
  };
};

const stepBuiltinType = function (state, control) {
  const {name} = control.node[1];
  const result = ['builtin', name];
  return {control: control.cont, result};
};

const stepPointerType = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  const result = ['pointer', state.result];
  return {control: control.cont, result};
};

const stepConstantArrayType = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    return {control: enter(node[2][0], {...control, step: 1})};
  }
  if (step === 1) {
    const elemType = state.result;
    return {control: enter(node[2][1], {...control, step: 2, elemType})};
  }
  const {elemType} = control;
  const elemCount = state.result;
  const result = ['array', elemType, elemCount];
  return {control: control.cont, result};
};

const stepFunctionProtoType = function (state, control) {
  const {node, step} = control;
  const cont = {...control, step: step + 1};
  if (step === 1) {
    cont.result = state.result;
    cont.params = [];
  } else if (step > 1) {
    cont.params = control.params.slice();
    cont.params.push(state.result);
  }
  if (step < node[2].length) {
    return {control: enter(node[2][step], cont)};
  }
  return {
    control: control.cont,
    result: ['function', cont.result, cont.params]
  };
};

const stepParmVarDecl = function (state, control) {
  const {node, step} = control;
  if (step === 0) {
    return {
      control: enter(node[2][0], {...control, step: step + 1})
    };
  }
  const name = node[1].name;
  const type = state.result;
  return {control: control.cont, result: {name, type}};
};

export const getStep = function (state, control) {
  switch (control.node[0]) {
  case "CompoundStmt":
    return stepCompoundStmt(state, control);
  case "DeclStmt":
    return stepDeclStmt(state, control);
  case "ForStmt":
    return stepForStmt(state, control);
  case "WhileStmt":
    return stepWhileStmt(state, control);
  case "DoStmt":
    return stepDoStmt(state, control);
  case "BreakStmt":
    return stepBreakStmt(state, control);
  case "ContinueStmt":
    return stepContinueStmt(state, control);
  case "IfStmt":
    return stepIfStmt(state, control);
  case "ReturnStmt":
    return stepReturnStmt(state, control);
  case "VarDecl":
    return stepVarDecl(state, control);
  case 'ParenExpr':
    return stepParenExpr(state, control);
  case "CallExpr":
    return stepCallExpr(state, control);
  case "ImplicitCastExpr":
    return stepImplicitCastExpr(state, control);
  case "DeclRefExpr":
    return stepDeclRefExpr(state, control);
  case "IntegerLiteral":
    return stepIntegerLiteral(state, control);
  case "CharacterLiteral":
    return stepCharacterLiteral(state, control);
  case "FloatingLiteral":
    return stepFloatingLiteral(state, control);
  case "StringLiteral":
    return stepStringLiteral(state, control);
  case "UnaryOperator":
    switch (control.node[1].opcode) {
      case 'Plus': case 'Minus': case 'LNot': case 'Not':
        return stepUnaryOperator(state, control);
      case 'PreInc': case 'PreDec': case 'PostInc': case 'PostDec':
        return stepAssignmentUnaryOperator(state, control);
      case 'AddrOf':
        return stepAddrOf(state, control);
      case 'Deref':
        return stepDeref(state, control);
      default:
        return {
          control,
          error: 'cannot step through UnaryOperator ' + control.node[1].opcode
        };
    }
    break;
  case 'UnaryExprOrTypeTraitExpr':
    return stepUnaryExprOrTypeTraitExpr(state, control);
  case 'BinaryOperator':
    if (control.node[1].opcode === 'Assign')
      return stepAssignmentOperator(state, control);
    else
      return stepBinaryOperator(state, control);
  case 'CompoundAssignOperator':
    return stepAssignmentBinaryOperator(state, control);
  case 'CStyleCastExpr':
    return stepCStyleCastExpr(state, control);
  case 'ArraySubscriptExpr':
    return stepArraySubscriptExpr(state, control);
  case 'BuiltinType':
    return stepBuiltinType(state, control);
  case 'PointerType':
    return stepPointerType(state, control);
  case 'ConstantArrayType':
    return stepConstantArrayType(state, control);
  case 'FunctionProtoType':
  case 'FunctionNoPrototype': // XXX spelling, is it ok to call stepFunctionProtoType?
    return stepFunctionProtoType(state, control);
  case 'ParmVarDecl':
    return stepParmVarDecl(state, control);
  }
  return {
    control,
    error: 'cannot step through ' + control.node[0]
  };
};
