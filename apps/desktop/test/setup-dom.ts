// jsdom does not implement object URLs. The renderer and Storybook browsers do,
// so the unit environment supplies a stand-in for components that preview files.
URL.createObjectURL = () => "blob:unit-object-url";
URL.revokeObjectURL = () => undefined;
