# SCSS Setup Guide

## Overview
The CSS files have been refactored to SCSS for better maintainability. The SCSS files use proper nesting, which makes the styles more readable and organized.

## Files
- `public/npo-base.scss` - Base styles and CSS variables
- `public/style.scss` - Main application styles
- `public/theme-npo.scss` - NPO theme overrides

## Installation
First, install the SCSS compiler:
```bash
npm install
```

## Compilation
To compile SCSS to CSS:
```bash
npm run build:scss
```

To watch for changes and auto-compile:
```bash
npm run watch:scss
```

## Key SCSS Features Used
1. **Nesting** - Related selectors are nested for better organization
2. **Parent selector (&)** - Used for pseudo-classes, modifiers, and BEM-style naming
3. **No variables/mixins added** - To maintain exact output parity with original CSS

## Notes
- The compiled CSS output is identical to the original CSS files
- SCSS files maintain the same structure as the original CSS
- No SCSS-specific features (variables, mixins, functions) were added to ensure output matches exactly
- The HTML still references the `.css` files, which are generated from the `.scss` sources