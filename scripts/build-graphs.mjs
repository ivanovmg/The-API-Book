import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'path';
import puppeteer from 'puppeteer';
import { templates } from '../src/templates.mjs';
import express from 'express';

const args = process.argv.slice(2);
const port = process.env.PORT ?? 3030;
const dir = process.cwd();
const langs = (args[0] || 'en,ru').split(',');
const target = args[1];

async function buildGraphs(langs, target, srcDir, dstDir, urlBuilder) {
    for (const lang of langs) {
        const graphDir = resolve(srcDir, lang, 'graphs');
        const targets = target
            ? [resolve(graphDir, target)]
            : await getGraphList(graphDir);

        console.log(
            `Lang=${lang}, ${targets.length} .mermaid files to process`
        );

        for (const t of targets) {
            await buildGraph(lang, t, dstDir, urlBuilder(t));
        }
    }
}

async function getGraphList(srcDir) {
    const files = await readdir(srcDir);
    const result = [];
    for (const file of files) {
        if (file.endsWith('.mermaid')) {
            result.push(resolve(srcDir, file));
        }
    }
    return result;
}

async function buildGraph(lang, target, dstDir, url) {
    const targetName = basename(target);
    console.log(`Processing ${target}, basename: ${targetName} dst: ${dstDir}`);
    const browser = await puppeteer.launch({
        headless: 'new',
        product: 'chrome',
        defaultViewport: {
            deviceScaleFactor: 2,
            width: 1200,
            height: 1200
        }
    });
    const outFile = resolve(
        dstDir,
        `${targetName.replace('.mermaid', '')}.${lang}.png`
    );
    const page = await browser.newPage();
    await page.goto(url, {
        waitUntil: 'networkidle0'
    });
    console.log(`URL ${url} loaded`);
    const $canvas = await page.$('svg');
    const bounds = await $canvas.boundingBox();
    // const body = await page.$('body');
    await $canvas.screenshot({
        path: outFile,
        type: 'png',
        captureBeyondViewport: true,
        clip: bounds
    });
    await browser.close();
    console.log(`File ${outFile} saved`);
}

async function main() {
    const app = express();
    app.use('/src', express.static('src'))
        .use('/docs', express.static('docs'))
        .get('/graph', async (req, res, next) => {
            try {
                const file = req.query.file;
                console.log(`Reading file "${file}"`);
                const html = templates.graphHtmlTemplate(
                    (await readFile(file)).toString('utf-8')
                );
                res.status(200);
                res.end(html);
            } catch (e) {
                next(e);
            }
        })
        .use((req, res, error, next) => {
            res.status(500);
            res.end(error.toString());
            throw error;
        });

    app.listen(port, () => {
        console.log(`Graph server started at localhost:${port}`);
    });

    await buildGraphs(
        langs,
        target,
        resolve(dir, 'src'),
        resolve(dir, 'src', 'img', 'graphs'),
        (file) =>
            `http://localhost:${port}/graph?file=${encodeURIComponent(file)}`
    );

    console.log('All graphs built successfully');

    await new Promise((r) => setTimeout(() => r(), 60 * 60 * 1000));
}

main()
    .catch((e) => {
        console.error(e);
    })
    .finally(() => {
        console.log('Graph build done');
        process.exit(0);
    });
