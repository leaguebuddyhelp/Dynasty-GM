// Load environment before modules resolve runtime storage paths.
import dotenv from 'dotenv';
dotenv.config({ path: process.env.dotenv_config_path || '.env' });
await import('./src/app.js');
