import typescriptEslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        eqeqeq: "warn",
        "no-throw-literal": "warn",
    },
}, eslintConfigPrettier, {
    files: ["**/*.ts"],
    rules: {
        curly: "warn",
        "max-len": ["warn", {
            code: 100,
            ignoreUrls: false,
            ignoreStrings: false,
            ignoreTemplateLiterals: false,
        }],
    },
}];
