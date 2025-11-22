import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIGESTS_DIR = path.join(__dirname, '../../digests');
const OUTPUT_FILE = path.join(__dirname, '../public/digests.json');

async function generateIndex() {
    try {
        // Ensure public directory exists
        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

        // Check if digests directory exists
        try {
            await fs.access(DIGESTS_DIR);
        } catch {
            console.log('No digests directory found. Creating empty index.');
            await fs.writeFile(OUTPUT_FILE, JSON.stringify([], null, 2));
            return;
        }

        const files = await fs.readdir(DIGESTS_DIR);
        const digests = [];

        for (const file of files) {
            if (file.endsWith('.md')) {
                const filePath = path.join(DIGESTS_DIR, file);
                const stats = await fs.stat(filePath);

                // Extract date from filename: bluesky-digest-YYYY-MM-DD-HH-MM-SS.md
                const match = file.match(/bluesky-digest-(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2})\.md/);

                let date;
                if (match) {
                    const [, datePart, timePart] = match;
                    date = new Date(`${datePart}T${timePart.replace(/-/g, ':')}`);
                } else {
                    date = stats.mtime;
                }

                digests.push({
                    filename: file,
                    date: date.toISOString(),
                    size: stats.size
                });
            }
        }

        // Sort by date descending
        digests.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        await fs.writeFile(OUTPUT_FILE, JSON.stringify(digests, null, 2));
        console.log(`Generated index with ${digests.length} digests.`);

    } catch (error) {
        console.error('Error generating index:', error);
        process.exit(1);
    }
}

generateIndex();
