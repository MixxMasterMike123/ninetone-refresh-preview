# Ninetone Records Website

A modern, responsive website for Ninetone Records built with Tailwind CSS and Alpine.js.

## Features

- Modern, clean design
- Responsive layout
- Tab system for Active and Previous Artists
- Card-based artist presentation
- Smooth animations and transitions
- Social media integration

## Technical Stack

- HTML5
- Tailwind CSS for styling
- Alpine.js for interactivity
- Vite for development and building

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

4. Preview production build:
   ```bash
   npm run preview
   ```

## Project Structure

```
ninetone-refresh/
├── src/
│   └── styles.css
├── index.html
├── package.json
├── tailwind.config.js
└── README.md
```

## Customization

### Colors
The primary brand color (Ninetone Red) can be customized in `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      'ninetone-red': '#FF0000', // Replace with actual brand color
    }
  }
}
```

### Artist Cards
Artist information can be added by modifying the template in `index.html`. Each card supports:
- Artist name
- Genre
- Latest release
- Social media links
- Artist image

## Browser Support

The website is built with modern web standards and supports:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance

The website is optimized for:
- Fast initial load
- Smooth animations
- Responsive images
- Minimal JavaScript usage 