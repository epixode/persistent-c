
import {unboxAsInteger} from './value';

export const sizeOfType = function (ty) {
  switch (ty[0]) {
    case 'builtin':
      switch (ty[1]) {
        case 'char': case 'unsigned char':
          return 1;
        case 'short': case 'unsigned short':
          return 2;
        case 'int': case 'unsigned int':
          return 4;
        case 'long': case 'unsigned long':
          return 4;
        case 'long long': case 'unsigned long long':
          return 8;
        case 'float':
          return 4;
        case 'double':
          return 8;
        default:
          throw ('sizeof builtin type ' + ty[1])
      }
    case 'array':
      return sizeOfType(ty[1]) * unboxAsInteger(ty[2]);
    case 'pointer':
      return 4;
    default:
      throw ('sizeof type ' + JSON.stringify(ty));
  }
};
