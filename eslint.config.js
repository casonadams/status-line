import js from "@eslint/js";
import tseslint from "typescript-eslint";

const policyRules = {
	"max-lines": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
	"max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
	"max-params": ["error", 3],
	"no-empty": ["error", { allowEmptyCatch: false }],
	"no-restricted-syntax": [
		"error",
		{
			selector: "CallExpression[callee.property.name='only']",
			message: "Focused tests must not be committed.",
		},
	],
};

export default tseslint.config(
	{
		ignores: ["node_modules/**"],
	},
	{
		...js.configs.recommended,
		languageOptions: {
			globals: {
				process: "readonly",
			},
		},
	},
	...tseslint.configs.strict,
	{
		files: ["extensions/**/*.ts"],
		rules: {
			...policyRules,
			"@typescript-eslint/ban-ts-comment": "error",
			"@typescript-eslint/no-explicit-any": "error",
		},
	},
);
