import * as fs from "fs";
import * as path from "path";
import puppeteer, { Page } from "puppeteer";
import sharp from "sharp";

function getDrawioFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getDrawioFiles(filePath));
    } else if (filePath.endsWith(".drawio")) {
      results.push(filePath);
    }
  }
  return results;
}

async function renderDrawio(page: Page, drawioPath: string) {
  const dir = path.dirname(drawioPath);
  const baseName = path.basename(drawioPath, ".drawio");
  const svgPath = path.join(dir, `${baseName}.svg`);
  const pngPath = path.join(dir, `${baseName}.png`);
  const pdfPath = path.join(dir, `${baseName}.pdf`);

  console.log(`\nRendering: ${drawioPath}`);

  // Read XML content
  const xmlContent = fs.readFileSync(drawioPath, "utf8");

  // Create Draw.io Viewer JSON config with visibility checks disabled
  const config = {
    highlight: "#3B52DF",
    nav: true,
    resize: true,
    lightbox: false,
    "check-visible-state": false,
    xml: xmlContent
  };

  const configJson = JSON.stringify(config);
  const encodedConfigJson = encodeURIComponent(configJson);

  // Load local Draw.io static viewer JS content to support offline rendering
  const viewerScriptPath = path.resolve(__dirname, "viewer-static.min.js");
  if (!fs.existsSync(viewerScriptPath)) {
    throw new Error(`viewer-static.min.js not found at ${viewerScriptPath}. Please run the download script or verify it exists.`);
  }
  const viewerScriptContent = fs.readFileSync(viewerScriptPath, "utf8");

  // Local HTML container with offline Draw.io static viewer script inlined
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Draw.io Exporter</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #FFFFFF; /* High contrast White background */
      overflow: hidden;
      display: inline-block;
    }
    .mxgraph {
      display: inline-block;
      border: none;
    }
  </style>
  <script>
    // Define a dummy MathJax object to bypass dynamic CDN script loading
    window.MathJax = {
      startup: {
        pageReady: function() {}
      }
    };
    try {
      ${viewerScriptContent}
      if (window.Editor) {
        window.Editor.containsMath = function() { return false; };
      }
    } catch(e) {
      console.error("Error inside static viewer load:", e.message || e);
    }
  </script>
</head>
<body>
  <div class="mxgraph"></div>
  <script>
    try {
      // Capture Graph and GraphViewer instances
      window.capturedGraphs = [];
      const originalGraph = window.Graph;
      if (originalGraph) {
        window.Graph = function() {
          const inst = new originalGraph(...arguments);
          window.capturedGraphs.push(inst);
          return inst;
        };
        window.Graph.prototype = originalGraph.prototype;
        Object.assign(window.Graph, originalGraph);
      }

      window.capturedViewers = [];
      const originalGV = window.GraphViewer;
      if (originalGV) {
        window.GraphViewer = function() {
          const inst = new originalGV(...arguments);
          window.capturedViewers.push(inst);
          return inst;
        };
        window.GraphViewer.prototype = originalGV.prototype;
        Object.assign(window.GraphViewer, originalGV);
      }

      // XML Decompression helper
      function decompressDiagram(text) {
        try {
          const binary = atob(text.trim());
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const decompressed = window.pako.inflateRaw(bytes, { to: 'string' });
          return decodeURIComponent(decompressed);
        } catch (e) {
          console.error("Failed to decompress diagram:", e);
          return null;
        }
      }

      // Multi-Page XML Merger
      function mergeMultiPageXml(xmlStr) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlStr, "application/xml");
        const diagrams = Array.from(doc.getElementsByTagName("diagram"));
        if (diagrams.length <= 1) return xmlStr;

        const firstDiagram = diagrams[0];
        let firstModelStr = firstDiagram.textContent.trim();
        if (!firstModelStr.startsWith("<mxGraphModel>")) {
          firstModelStr = decompressDiagram(firstModelStr) || firstModelStr;
        }
        const firstModelDoc = parser.parseFromString(firstModelStr, "application/xml");
        const firstModel = firstModelDoc.querySelector("mxGraphModel");
        const firstRoot = firstModel.querySelector("root");

        let accumulatedHeight = 0;

        const getPageBounds = (rootEl) => {
          let minY = Infinity, maxY = -Infinity;
          let minX = Infinity, maxX = -Infinity;
          
          rootEl.querySelectorAll("mxCell").forEach(cell => {
            const geo = cell.querySelector("mxGeometry");
            if (geo) {
              const x = parseFloat(geo.getAttribute("x") || "0");
              const y = parseFloat(geo.getAttribute("y") || "0");
              const w = parseFloat(geo.getAttribute("width") || "0");
              const h = parseFloat(geo.getAttribute("height") || "0");
              
              if (w > 0 && h > 0) {
                if (y < minY) minY = y;
                if (y + h > maxY) maxY = y + h;
                if (x < minX) minX = x;
                if (x + w > maxX) maxX = x + w;
              }
            }
          });
          
          return { minY, maxY, minX, maxX };
        };

        const firstBounds = getPageBounds(firstRoot);
        accumulatedHeight = firstBounds.maxY !== -Infinity ? firstBounds.maxY : 1000;

        for (let j = 1; j < diagrams.length; j++) {
          const diag = diagrams[j];
          let modelStr = diag.textContent.trim();
          if (!modelStr.startsWith("<mxGraphModel>")) {
            modelStr = decompressDiagram(modelStr) || modelStr;
          }
          const modelDoc = parser.parseFromString(modelStr, "application/xml");
          const modelEl = modelDoc.querySelector("mxGraphModel");
          if (!modelEl) continue;
          const root = modelEl.querySelector("root");
          if (!root) continue;

          const bounds = getPageBounds(root);
          if (bounds.minY === Infinity) continue; // Empty page

          const pageHeight = bounds.maxY - bounds.minY;
          const shiftY = accumulatedHeight - bounds.minY + 300;
          const prefix = "p" + j + "_";

          const cells = Array.from(root.querySelectorAll("mxCell"));
          cells.forEach(cell => {
            const id = cell.getAttribute("id");
            if (id === "0" || id === "1") return;

            cell.setAttribute("id", prefix + id);

            const parent = cell.getAttribute("parent");
            if (parent && parent !== "0" && parent !== "1") {
              cell.setAttribute("parent", prefix + parent);
            } else if (!parent || parent === "1") {
              cell.setAttribute("parent", "1");
            }

            const source = cell.getAttribute("source");
            if (source && source !== "0" && source !== "1") {
              cell.setAttribute("source", prefix + source);
            }

            const target = cell.getAttribute("target");
            if (target && target !== "0" && target !== "1") {
              cell.setAttribute("target", prefix + target);
            }

            const geo = cell.querySelector("mxGeometry");
            if (geo) {
              const y = parseFloat(geo.getAttribute("y") || "0");
              geo.setAttribute("y", (y + shiftY).toString());

              geo.querySelectorAll("mxPoint").forEach(pt => {
                const py = pt.getAttribute("y");
                if (py) {
                  pt.setAttribute("y", (parseFloat(py) + shiftY).toString());
                }
              });
            }

            const importedCell = firstModelDoc.importNode(cell, true);
            firstRoot.appendChild(importedCell);
          });

          accumulatedHeight += pageHeight + 300;
        }

        firstDiagram.textContent = "";
        const serializedModel = new XMLSerializer().serializeToString(firstModel);
        const modelNode = doc.importNode(new DOMParser().parseFromString(serializedModel, "application/xml").documentElement, true);
        firstDiagram.appendChild(modelNode);

        for (let j = 1; j < diagrams.length; j++) {
          diagrams[j].parentNode.removeChild(diagrams[j]);
        }

        return new XMLSerializer().serializeToString(doc);
      }

      // Read config, merge multi-pages if needed
      const configStr = decodeURIComponent("${encodedConfigJson}");
      const config = JSON.parse(configStr);
      if (config.xml) {
        config.xml = mergeMultiPageXml(config.xml);
      }

      const element = document.querySelector(".mxgraph");
      element.setAttribute("data-mxgraph", JSON.stringify(config));
      
      if (window.GraphViewer) {
        window.GraphViewer.processElements();
      }
    } catch (e) {
      console.error("Error setting configuration:", e.message || e);
    }
  </script>
</body>
</html>
  `;

  // Load HTML page
  await page.setContent(html, { waitUntil: "load" });

  try {
    // Wait for the viewer script to render the XML to an SVG element in the DOM
    await page.waitForSelector("div.mxgraph svg", { timeout: 20000 });

    // Additional robust stability check: ensure the SVG element has stabilized with non-zero geometry
    await page.waitForFunction(() => {
      const svg = document.querySelector("div.mxgraph svg");
      if (!svg) return false;
      const rect = svg.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && svg.querySelectorAll("g, rect, path, text").length > 0;
    }, { timeout: 20000 });

    // Small delay to ensure all transition/rendering effects are fully resolved
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err: any) {
    throw new Error(`Failed to render Draw.io diagram in browser: ${err.message}`);
  }

  // Retrieve and calculate bounds, validate diagram structure, and retry if necessary
  let validationResult: any = null;
  let attempt = 0;
  const maxAttempts = 3;
  let customPadding = 300;

  while (attempt < maxAttempts) {
    validationResult = await page.evaluate((paddingVal) => {
      const graphs = (window as any).capturedGraphs;
      if (!graphs || graphs.length === 0) {
        return { error: "No graphs captured during rendering" };
      }
      const graph = graphs[0];
      const viewer = (window as any).capturedViewers[0];
      
      if (viewer) {
        viewer.autoFit = false;
        viewer.responsive = false;
        viewer.autoCrop = false;
        viewer.handlingResize = false;
      }

      graph.resizeContainer = false;
      graph.view.setScale(1.0);
      graph.view.setTranslate(0, 0);

      let bounds = graph.getGraphBounds();
      let scale = graph.view.scale; // 1.0

      // Stabilization loop to verify and include all cell boundaries
      for (let iter = 0; iter < 5; iter++) {
        let minX = bounds.x / scale;
        let minY = bounds.y / scale;
        let maxX = (bounds.x + bounds.width) / scale;
        let maxY = (bounds.y + bounds.height) / scale;

        const model = graph.getModel();
        const view = graph.getView();
        const states = view.states;

        states.visit((id: any, state: any) => {
          if (state.cell && state.cell.value) {
            let stateMinX = state.x / scale;
            let stateMinY = state.y / scale;
            let stateMaxX = (state.x + state.width) / scale;
            let stateMaxY = (state.y + state.height) / scale;

            if (stateMinX < minX) minX = stateMinX;
            if (stateMinY < minY) minY = stateMinY;
            if (stateMaxX > maxX) maxX = stateMaxX;
            if (stateMaxY > maxY) maxY = stateMaxY;

            if (state.text) {
              let labelMinX = state.text.x / scale;
              let labelMinY = state.text.y / scale;
              let labelMaxX = (state.text.x + state.text.width) / scale;
              let labelMaxY = (state.text.y + state.text.height) / scale;

              if (labelMinX < minX) minX = labelMinX;
              if (labelMinY < minY) minY = labelMinY;
              if (labelMaxX > maxX) maxX = labelMaxX;
              if (labelMaxY > maxY) maxY = labelMaxY;
            }

            if (state.absolutePoints) {
              state.absolutePoints.forEach((p: any) => {
                let px = p.x / scale;
                let py = p.y / scale;
                if (px < minX) minX = px;
                if (py < minY) minY = py;
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
              });
            }
          }
        });

        const newWidth = maxX - minX;
        const newHeight = maxY - minY;

        if (Math.abs(bounds.x - minX * scale) < 1 &&
            Math.abs(bounds.y - minY * scale) < 1 &&
            Math.abs(bounds.width - newWidth * scale) < 1 &&
            Math.abs(bounds.height - newHeight * scale) < 1) {
          break;
        }

        bounds = {
          x: minX * scale,
          y: minY * scale,
          width: newWidth * scale,
          height: newHeight * scale
        };
      }

      const minX = bounds.x / scale;
      const minY = bounds.y / scale;
      graph.view.setScale(1.0);
      graph.view.setTranslate(-minX + paddingVal, -minY + paddingVal);

      const targetWidth = Math.ceil(bounds.width / scale + paddingVal * 2);
      const targetHeight = Math.ceil(bounds.height / scale + paddingVal * 2);

      const container = graph.container;
      container.style.width = targetWidth + "px";
      container.style.height = targetHeight + "px";

      graph.sizeDidChange();

      const svg = document.querySelector("div.mxgraph svg");
      if (svg) {
        svg.setAttribute("width", targetWidth.toString());
        svg.setAttribute("height", targetHeight.toString());
        svg.setAttribute("viewBox", `0 0 ${targetWidth} ${targetHeight}`);
      }

      // Count entities (table swimlanes) and check if they are fully inside container bounds
      const entities = [];
      const model = graph.getModel();
      for (const id in model.cells) {
        if (id.startsWith("table_")) {
          entities.push(model.cells[id]);
        }
      }
      
      const totalEntities = entities.length;
      let visibleEntities = 0;
      
      entities.forEach(cell => {
        const state = graph.view.getState(cell);
        if (state && state.width > 0 && state.height > 0) {
          const inside = (
            state.x >= 0 &&
            state.y >= 0 &&
            state.x + state.width <= targetWidth &&
            state.y + state.height <= targetHeight
          );
          if (inside) {
            visibleEntities++;
          }
        }
      });

      const finalBounds = graph.getGraphBounds();
      const isFullyContained = (
        finalBounds.x >= 0 &&
        finalBounds.y >= 0 &&
        finalBounds.x + finalBounds.width <= targetWidth &&
        finalBounds.y + finalBounds.height <= targetHeight
      );

      let connectorsValid = true;
      for (const id in model.cells) {
        const cell = model.cells[id];
        if (model.isEdge(cell)) {
          const state = graph.view.getState(cell);
          if (state) {
            if (state.absolutePoints) {
              for (const pt of state.absolutePoints) {
                if (pt.x < 0 || pt.y < 0 || pt.x > targetWidth || pt.y > targetHeight) {
                  connectorsValid = false;
                  break;
                }
              }
            }
            if (state.text) {
              if (state.text.x < 0 || state.text.y < 0 || 
                  state.text.x + state.text.width > targetWidth || 
                  state.text.y + state.text.height > targetHeight) {
                connectorsValid = false;
              }
            }
          }
        }
      }

      return {
        width: targetWidth,
        height: targetHeight,
        totalEntities,
        visibleEntities,
        isFullyContained,
        connectorsValid,
        validationPassed: (visibleEntities === totalEntities) && isFullyContained && connectorsValid
      };
    }, customPadding);

    if (validationResult.error) {
      throw new Error(validationResult.error);
    }

    if (validationResult.validationPassed) {
      break;
    }

    console.warn(`Validation failed on attempt ${attempt + 1}. Visible entities: ${validationResult.visibleEntities}/${validationResult.totalEntities}. Fully contained: ${validationResult.isFullyContained}. Connectors valid: ${validationResult.connectorsValid}. Retrying...`);
    customPadding += 100;
    attempt++;
  }

  if (attempt >= maxAttempts || !validationResult || !validationResult.validationPassed) {
    throw new Error(`Diagram validation failed: Not all entities, connectors, or labels could be fully contained within export bounds after ${maxAttempts} attempts.`);
  }

  const dimensions = {
    width: validationResult.width,
    height: validationResult.height
  };

  // 1. Export SVG
  const svgHtml = await page.evaluate(() => {
    const svg = document.querySelector("div.mxgraph svg");
    return svg ? svg.outerHTML : "";
  });
  
  if (svgHtml) {
    const svgFileContent = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svgHtml}`;
    fs.writeFileSync(svgPath, svgFileContent, "utf8");
    console.log(`-> Generated SVG: ${svgPath}`);
  }

  // Configure high-DPI resolution viewport dynamically based on diagram size
  // Configure high-DPI resolution viewport dynamically based on diagram size
  let scaleFactor = 4.0;
  if (process.env.ERD_SCALE) {
    scaleFactor = parseFloat(process.env.ERD_SCALE);
  } else {
    const totalArea = dimensions.width * dimensions.height;
    if (totalArea > 8000000) {
      scaleFactor = 1.5;
    } else if (totalArea > 4000000) {
      scaleFactor = 2.0;
    }
  }

  // Ensure scaled viewport dimensions do not exceed Chromium's canvas/viewport stability limit (~30,000 pixels)
  const maxDimension = Math.max(dimensions.width, dimensions.height);
  if (maxDimension * scaleFactor > 30000) {
    scaleFactor = Math.max(0.5, 30000 / maxDimension);
  }

  await page.setViewport({
    width: dimensions.width,
    height: dimensions.height,
    deviceScaleFactor: scaleFactor
  });

  // 2. Export PNG
  try {
    const buffer = await page.screenshot({
      type: "png",
      omitBackground: false // Keep background color #FFFFFF
    });
    await sharp(buffer, { limitInputPixels: false })
      .withMetadata({ density: 300 })
      .toFile(pngPath);
    console.log(`-> Generated PNG (${scaleFactor.toFixed(2)}x): ${pngPath}`);
  } catch (pngErr: any) {
    console.error(`-> Failed to generate PNG for ${baseName}: ${pngErr.message}`);
  }

  // 3. Export PDF with matching custom dimensions
  try {
    await page.pdf({
      path: pdfPath,
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`,
      printBackground: true,
      pageRanges: "1",
      margin: {
        top: "0px",
        right: "0px",
        bottom: "0px",
        left: "0px"
      }
    });
    console.log(`-> Generated PDF: ${pdfPath}`);
  } catch (pdfErr: any) {
    console.error(`-> Failed to generate PDF for ${baseName}: ${pdfErr.message}`);
  }
}

async function main() {
  const erdDir = path.resolve(__dirname, "../docs/erd/modules");
  if (!fs.existsSync(erdDir)) {
    console.error(`ERD modules directory not found at: ${erdDir}`);
    process.exit(1);
  }

  const drawioFiles = getDrawioFiles(erdDir);
  console.log(`Found ${drawioFiles.length} Draw.io diagram files to render.`);

  if (drawioFiles.length === 0) {
    console.log("No diagrams to render.");
    process.exit(0);
  }

  const startTime = Date.now();

  // Launch headless browser
  console.log("Launching headless browser to render diagrams...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    for (const file of drawioFiles) {
      let page: Page | null = null;
      try {
        page = await browser.newPage();

        // Listen for browser logs & errors to ease debugging
        page.on("console", (msg) => {
          const text = msg.text();
          const type = msg.type() as string;
          // Ignore routine logs to avoid cluttering, but log errors/warnings
          if (type === "error" || type === "warning" || text.includes("error") || text.includes("fail")) {
            console.log(`[Browser Console] ${type.toUpperCase()}: ${text}`);
          }
        });
        page.on("pageerror", (err: any) => {
          console.error(`[Browser PageError]: ${err.message}`);
        });

        await renderDrawio(page, file);
      } catch (err: any) {
        console.error(`Error rendering diagram for ${file}:`, err.message);
      } finally {
        if (page) {
          try {
            await page.close();
          } catch (e) {}
        }
      }
    }
  } finally {
    await browser.close();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nDraw.io rendering process completed successfully in ${duration} seconds.`);
}

main();
