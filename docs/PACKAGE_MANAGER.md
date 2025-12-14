# Package Manager System

## Overview
AUR-inspired package management system for ZynqOS with local IndexedDB storage.

## Features
- Browse and install packages from registries
- Upload custom WASM files
- Update management
- WASM validation & security checks
- System apps are pre-installed and cannot be removed

## Architecture

### Storage
- **IndexedDB**: Stores package metadata and binaries separately
- **LocalStorage**: Registry configuration and cache (5-min TTL)

### Package Types
- `wasm`: Pure WebAssembly modules
- `wasi`: WASI-compatible applications
- `web-app`: Web application bundles

### Security
- WASM magic number validation
- SHA-256 checksum verification
- Permission declarations
- Source verification (official/community/user)

## Usage

```typescript
import { installPackage, uploadPackage, getInstalledPackages } from './packages'

// Install from registry
await installPackage('image-viewer')

// Upload custom package
await uploadPackage({ file: wasmFile, metadata: { name: 'My App', ... } })

// List installed
const packages = await getInstalledPackages()
```

## File Structure

```
src/packages/
├── types.ts          # Type definitions
├── storage.ts        # IndexedDB layer
├── registry.ts       # Registry management
├── manager.ts        # Package operations
├── validator.ts      # Validation & security
├── config.ts         # Configuration
├── index.ts          # Main exports
└── examples.ts       # Usage examples

src/apps/store/
└── ui.tsx            # Store interface

public/apps/
└── store-manifest.json # Package registry
```

## System Apps
Pre-installed apps that appear in the "Installed" tab:
- Files, Zynqpad, Terminal, Python, Wednesday AI, Calculator, PhantomSurf, Settings, Package Import

These cannot be uninstalled and are managed by the system.

## Configuration
Edit `src/packages/config.ts` for:
- Storage limits (default: 100MB max)
- Cache duration (default: 5 minutes)
- Registry URLs
- Validation settings
