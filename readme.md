# MX Ink WebXR

This template uses Three.js and WebXR to provide an immersive 3D painting experience using Logitech MX-INK.

## Prerequisites

- Node.js (version 12.0 or higher recommended)
- Logitech MX-INK Stylus
- Quest 3/3S headset 

## Setup

1. Clone the repository:
```sh
git clone https://github.com/yourusername/mx-ink-webxr.git
cd mx-ink-webxr
```

2. Install dependencies:
```sh
npm install
```

## Running the Application

To run the application in development mode:
```sh
npm run dev
```

This will start a local development server. Open your browser and navigate to `http://localhost:5173` (or the port specified in your console output).

## Building for Production

To create a production build:
```sh
npm run build
```


This will generate optimized files in the `dist` directory.

## Deploying

After building, you can deploy the contents of the `dist` directory to your preferred hosting platform.

## Usage

1. Open the application in Quest browser.
2. Click the "Enter XR" button to start.
3. Use your stylus to paint in 3D space.
4. Enjoy!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [MIT License](LICENSE).
