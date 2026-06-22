// Static asset modules resolved by Metro (return an opaque asset id at runtime,
// consumed via Image.resolveAssetSource). Declared so tsc accepts the imports.
declare module "*.wav" {
  const asset: number;
  export default asset;
}
declare module "*.mp3" {
  const asset: number;
  export default asset;
}
declare module "*.png" {
  const asset: number;
  export default asset;
}
