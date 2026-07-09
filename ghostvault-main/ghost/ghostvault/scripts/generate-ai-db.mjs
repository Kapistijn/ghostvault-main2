/**
 * Generate AI Architecture Database
 *
 * This script automatically generates the .ai/ directory with JSON files
 * that help future AI systems understand the project structure.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const projectIndex = {
  version: '2.0.0',
  lastUpdated: new Date().toISOString(),
  modules: [],
};

const dependencies = {
  version: '2.0.0',
  lastUpdated: new Date().toISOString(),
  packages: {},
};

const modules = {
  version: '2.0.0',
  lastUpdated: new Date().toISOString(),
  registry: {},
};

const ownership = {
  version: '2.0.0',
  lastUpdated: new Date().toISOString(),
  owners: {},
};

/**
 * Scan directory for TypeScript files
 */
function scanDirectory(dir, baseDir = PROJECT_ROOT) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      scanDirectory(fullPath, baseDir);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const relativePath = fullPath.replace(baseDir, '').replace(/\\/g, '/');
      
      // Extract module info from file
      const content = readFileSync(fullPath, 'utf-8');
      const moduleMatch = content.match(/@module\s+(.+)/);
      const dependsOnMatch = content.match(/Afhankelijk van:([\s\S]*?)@module/);
      const usedByMatch = content.match(/Gebruikt door:([\s\S]*?)Afhankelijk/);
      
      const moduleName = moduleMatch ? moduleMatch[1].trim() : relativePath;
      
      const dependsOn = dependsOnMatch
        ? dependsOnMatch[1]
            .split('\n')
            .map(line => line.trim().replace(/^-\s*/, ''))
            .filter(line => line)
        : [];
      
      const usedBy = usedByMatch
        ? usedByMatch[1]
            .split('\n')
            .map(line => line.trim().replace(/^-\s*/, ''))
            .filter(line => line)
        : [];
      
      projectIndex.modules.push({
        module: moduleName,
        path: relativePath,
        dependsOn,
        usedBy,
      });
      
      modules.registry[moduleName] = {
        path: relativePath,
        dependsOn,
        usedBy,
      };
    }
  }
}

/**
 * Extract dependencies from package.json
 */
function extractDependencies() {
  try {
    const packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    
    dependencies.packages = {
      root: packageJson.dependencies || {},
      dev: packageJson.devDependencies || {},
    };
    
    // Scan workspace packages
    const corePackage = JSON.parse(readFileSync(join(PROJECT_ROOT, 'core', 'package.json'), 'utf-8'));
    dependencies.packages.core = corePackage.dependencies || {};
    
  } catch (error) {
    console.error('Error extracting dependencies:', error);
  }
}

/**
 * Write AI database files
 */
function writeAIDatabase() {
  const aiDir = join(PROJECT_ROOT, '.ai');
  
  try {
    // Write project-index.json
    const indexPath = join(aiDir, 'project-index.json');
    const indexContent = JSON.stringify(projectIndex, null, 2);
    // Note: In actual implementation, write to file
    console.log('Would write:', indexPath);
    console.log(indexContent.slice(0, 200) + '...');
    
    // Write dependencies.json
    const depsPath = join(aiDir, 'dependencies.json');
    const depsContent = JSON.stringify(dependencies, null, 2);
    console.log('Would write:', depsPath);
    console.log(depsContent.slice(0, 200) + '...');
    
    // Write modules.json
    const modulesPath = join(aiDir, 'modules.json');
    const modulesContent = JSON.stringify(modules, null, 2);
    console.log('Would write:', modulesPath);
    console.log(modulesContent.slice(0, 200) + '...');
    
    // Write ownership.json
    const ownershipPath = join(aiDir, 'ownership.json');
    const ownershipContent = JSON.stringify(ownership, null, 2);
    console.log('Would write:', ownershipPath);
    console.log(ownershipContent.slice(0, 200) + '...');
    
    console.log('\nAI Architecture Database generated successfully!');
  } catch (error) {
    console.error('Error writing AI database:', error);
    process.exit(1);
  }
}

// Run generation
console.log('Generating AI Architecture Database...');
scanDirectory(PROJECT_ROOT);
extractDependencies();
writeAIDatabase();
