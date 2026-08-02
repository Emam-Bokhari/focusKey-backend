import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";

async function main() {
  const drawioPath = path.resolve(__dirname, "../docs/erd/modules/user/er-diagram.drawio");
  console.log("Drawio file exists:", fs.existsSync(drawioPath));
  if (!fs.existsSync(drawioPath)) return;

  const xmlContent = fs.readFileSync(drawioPath, "utf8");

  // Base64 encode the XML to prevent quote/newline/entity clashing in HTML attribute
  const base64Xml = Buffer.from(xmlContent, "utf8").toString("base64");

  // Let's use the CDN URL for the Draw.io static viewer
  const viewerScriptUrl = "https://viewer.diagrams.net/js/viewer-static.min.js";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Draw.io Exporter Test</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #12121E;
      overflow: hidden;
      display: inline-block;
    }
    .mxgraph {
      display: inline-block;
      border: none;
    }
  </style>
  <script src="${viewerScriptUrl}"></script>
</head>
<body>
  <div class="mxgraph" id="diagram-container"></div>
  <script>
    (function() {
      try {
        const base64Xml = "${base64Xml}";
        const binaryString = atob(base64Xml);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const xml = new TextDecoder().decode(bytes);

        const config = {
          highlight: "#3B52DF",
          nav: true,
          resize: true,
          lightbox: false,
          xml: xml
        };

        const container = document.getElementById("diagram-container");
        container.setAttribute("data-mxgraph", JSON.stringify(config));
      } catch (err) {
        console.error("Initialization script error:", err.message);
      }
    })();
  </script>
</body>
</html>
  `;

  const tempHtmlPath = path.resolve(__dirname, "temp-viewer.html");
  fs.writeFileSync(tempHtmlPath, html, "utf8");
  const tempHtmlUrl = "file:///" + tempHtmlPath.replace(/\\/g, "/");

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"]
  });

  try {
    const page = await browser.newPage();

    page.on("console", (msg) => {
      console.log(`[BROWSER LOG] [${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    page.on("pageerror", (err: any) => {
      console.error(`[BROWSER PAGEERROR] ${err.message}`);
    });

    console.log("Navigating to temporary HTML page...");
    await page.goto(tempHtmlUrl, { waitUntil: "load" });

    // Try manually running processElements in case window load fired already
    console.log("Manually triggering processElements...");
    await page.evaluate(() => {
      try {
        if ((window as any).GraphViewer && typeof (window as any).GraphViewer.processElements === "function") {
          console.log("GraphViewer found, processing elements...");
          (window as any).GraphViewer.processElements();
        } else {
          console.error("GraphViewer or processElements is not defined.");
        }
      } catch (e: any) {
        console.error("Error in processElements call:", e.message);
      }
    });

    // Wait a couple of seconds to see what gets loaded/changed
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log("DOM content after 3 seconds:");
    const content = await page.content();
    console.log(content);

  } finally {
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
    await browser.close();
    console.log("Browser closed.");
  }
}

main().catch(console.error);
