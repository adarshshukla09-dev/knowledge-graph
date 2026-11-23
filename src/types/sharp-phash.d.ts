declare module "sharp-phash" {
  export default function phash(input: Buffer | Uint8Array): Promise<string>;
}

declare module "sharp-phash/distance" {
  export default function phashDistance(hashA: string, hashB: string): number;
}
