// Local password accounts are preserved in IndexedDB but cannot authenticate.
export async function signupLocal(..._args:unknown[]):Promise<never>{throw new Error('Use Google sign-in.');}
export async function loginLocal(..._args:unknown[]):Promise<never>{throw new Error('Use Google sign-in.');}
