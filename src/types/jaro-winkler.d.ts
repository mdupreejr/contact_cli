declare module 'jaro-winkler' {
  function jaroWinkler(str1: string, str2: string, options?: { caseSensitive?: boolean }): number;
  export = jaroWinkler;
}
