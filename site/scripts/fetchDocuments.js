import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const BASE_URL = 'https://www.kaa.org.tw/public_list_1.php';
const MAX_PAGES = 10;
const MAX_RETRIES = 3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      const delay = 1000 * 2 ** (attempt - 1);
      console.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${error.message}. Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

function buildPageUrl(page) {
  return `${BASE_URL}?t=0&search_input1=&search_input2=&search_input3=&b=${page}`;
}

function parseDocuments(html) {
  const $ = load(html);
  const table = $('table').first();
  const rows = table.find('tr').slice(1);

  const documents = [];

  rows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) {
      return;
    }

    const date = $(cells[0]).text().trim();
    const titleCell = $(cells[1]);
    const subjectLink = titleCell.find('a').attr('href');
    const subject = titleCell.find('a').text().trim() || titleCell.text().trim();
    const deadline = $(cells[2]).text().trim();

    const attachments = [];
    $(cells[3])
      .find('a')
      .each((__, link) => {
        const href = $(link).attr('href');
        const label = $(link).text().trim() || '附件';
        if (href) {
          attachments.push({
            label,
            url: new URL(href, BASE_URL).href,
          });
        }
      });

    documents.push({
      date,
      subject,
      subjectUrl: subjectLink ? new URL(subjectLink, BASE_URL).href : null,
      deadline,
      attachments,
    });
  });

  return documents;
}

async function writeData(documents) {
  const outDir = path.resolve(__dirname, '../public/data');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'documents.json');
  await fs.writeFile(
    outPath,
    JSON.stringify({ documents, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return outPath;
}

async function main() {
  try {
    const allDocuments = [];
    const seen = new Set();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = buildPageUrl(page);
      let html;
      try {
        html = await fetchWithRetry(url);
      } catch (error) {
        console.warn(`Failed to fetch page ${page}: ${error.message}`);
        break;
      }

      const documents = parseDocuments(html);
      if (documents.length === 0) {
        console.log(`Page ${page}: empty, stopping pagination.`);
        break;
      }

      let newCount = 0;
      for (const doc of documents) {
        const key = doc.subjectUrl || `${doc.date}|${doc.subject}`;
        if (!seen.has(key)) {
          seen.add(key);
          allDocuments.push(doc);
          newCount++;
        }
      }

      console.log(`Page ${page}: ${documents.length} rows, ${newCount} new`);

      if (documents.length < 10) {
        break;
      }

      await sleep(300);
    }

    if (allDocuments.length === 0) {
      throw new Error('未取得任何公告資料，請稍後再試。');
    }

    const outPath = await writeData(allDocuments);
    console.log(`Saved ${allDocuments.length} documents to ${outPath}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main();
