import "../src/app/globals.css";

/** @type { import('@storybook/react').Preview } */
const preview = {
  parameters: {
    // Dark background to match the app's dark theme
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#030712" },
        { name: "light", value: "#ffffff" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Enable axe-core accessibility checks for all stories
    a11y: {
      config: {
        rules: [
          {
            // Ensure all interactive elements have accessible names
            id: "button-name",
            enabled: true,
          },
          {
            // Ensure form fields have labels
            id: "label",
            enabled: true,
          },
        ],
      },
      options: {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      },
    },
  },
};

export default preview;
