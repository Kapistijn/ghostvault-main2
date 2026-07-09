declare module 'argon2-browser' {
  interface Argon2Result {
    hash: string;
    hashHex: string;
    encoded: string;
  }

  interface Argon2Options {
    pass: string;
    salt: string;
    time?: number;
    mem?: number;
    parallelism?: number;
    hashLen?: number;
    type?: number;
    distPath?: string;
  }

  enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2
  }

  interface Argon2Module {
    hash(options: Argon2Options): Promise<Argon2Result>;
    verify(hash: string, pass: string): Promise<boolean>;
    ArgonType: typeof ArgonType;
  }

  const argon2: Argon2Module;
  export default argon2;
  export const ArgonType: typeof ArgonType;
  export function hash(options: Argon2Options): Promise<Argon2Result>;
  export function verify(hash: string, pass: string): Promise<boolean>;
}
