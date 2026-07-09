declare module 'argon2-browser' {
  export const ArgonType: {
    Argon2i: 'Argon2i';
    Argon2d: 'Argon2d';
    Argon2id: 'Argon2id';
  };
  
  export type ArgonTypeValue = 'Argon2i' | 'Argon2d' | 'Argon2id';
  
  export interface Argon2Result {
    hashHex: string;
    hash: string;
    encoded: string;
  }
  
  export function argon2id(options: {
    pass: string;
    salt: string;
    type: ArgonTypeValue;
    mem: number;
    time: number;
    parallelism: number;
    hashLen: number;
  }): Promise<Argon2Result>;
  
  export function argon2i(options: {
    pass: string;
    salt: string;
    type: ArgonTypeValue;
    mem: number;
    time: number;
    parallelism: number;
    hashLen: number;
  }): Promise<Argon2Result>;
  
  export function argon2d(options: {
    pass: string;
    salt: string;
    type: ArgonTypeValue;
    mem: number;
    time: number;
    parallelism: number;
    hashLen: number;
  }): Promise<Argon2Result>;
}
