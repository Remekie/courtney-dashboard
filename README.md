# Your Project's Title...
Your project's description...

## Environments
- Preview: https://main--ise-boilerplate--aemdemos.aem.page/
- Live: https://main--ise-boilerplate--aemdemos.aem.live/

## Documentation

Before using the aem-block-collection, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:
1. [Developer Tutorial](https://www.aem.live/developer/ue-tutorial)
1. [Creating Blocks](https://www.aem.live/developer/universal-editor-blocks) and [Content Modelling](https://www.aem.live/developer/component-model-definitions)
1. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
1. [Web Performance](https://www.aem.live/developer/keeping-it-100)
1. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)
1. [AEM Block Collection](https://www.aem.live/developer/block-collection#block-collection-1)

## Installation

```sh
npm i
```

Linting and security
This project is using StyleLint and ESLint for Javascript. Our ESLint configuration includes 3 popular and reputable Javascript code quality and security plugins:

- SonarSource eslint-plugin-sonarjs, a code quality analyzer for JavaScript and TypeScript within the Sonar ecosystem (https://github.com/SonarSource/SonarJS/blob/master/packages/jsts/src/rules/README.md#eslint-rules)
- Interlace secure-coding plugin for general secure coding practices and OWASP compliance for JavaScript/TypeScript (https://eslint.interlace.tools/docs/security/plugin-secure-coding/rules)
- Interlace browser-security for XSS, cookie, and DOM security rules for client-side JavaScript (https://eslint.interlace.tools/docs/security/plugin-browser-security/rules).

They are included in this command, which is run automatically via a github action on every pull request:

```sh
npm run lint
```


## Local development

1. Create a new repository based on the `aem-block-collection` template and add a mountpoint in the `fstab.yaml`
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `ise-boilerplate` directory in your favorite IDE and start coding :)