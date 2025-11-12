# Agent Instructions for ContactsPlus

## Build/Test Commands
- Build: `npm run build` or `yarn build`
- Test all: `npm test` or `yarn test` 
- Single test: `npm test -- --testNamePattern="test name"` or `jest path/to/test.spec.js`
- Lint: `npm run lint` or `eslint src/`
- Type check: `tsc --noEmit` or `npm run type-check`

## Code Style Guidelines
- **Imports**: Use absolute imports from src/, group by external/internal, sort alphabetically
- **Naming**: camelCase for variables/functions, PascalCase for components/classes, UPPER_SNAKE_CASE for constants
- **Types**: Prefer interfaces over types, use strict TypeScript, avoid `any`
- **Functions**: Use arrow functions for callbacks, function declarations for main functions
- **Error Handling**: Use try/catch with specific error types, avoid silent failures
- **Comments**: Use JSDoc for functions, inline comments for complex logic only
- **Files**: One main export per file, use index.js for barrel exports
- **Testing**: Co-locate tests with source files, use descriptive test names
- **Async**: Prefer async/await over promises, handle errors explicitly
- **Formatting**: Use Prettier with 2-space indents, trailing commas, single quotes

## Project Structure
Follow conventional patterns: src/components, src/utils, src/types, src/hooks, src/services