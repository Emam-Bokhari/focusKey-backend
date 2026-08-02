import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function main() {
  const erdDir = path.resolve(__dirname, "../docs/erd/modules");
  if (!fs.existsSync(erdDir)) {
    console.error(`ERD modules directory not found at: ${erdDir}`);
    console.error("Please run 'npm run generate:diagram' first to generate and render the diagrams.");
    process.exit(1);
  }

  // Resolve the project root directory and dynamically determine its folder name
  const projectRootDir = path.resolve(__dirname, "..");
  const projectName = path.basename(projectRootDir);

  // Resolve the user's local PC's Downloads directory dynamically based on the project name
  const downloadsDir = path.join(os.homedir(), "Downloads", `${projectName}-erd-diagrams`);
  
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  console.log(`Exporting ER diagrams to: ${downloadsDir}...`);

  const modules = fs.readdirSync(erdDir).filter((file) => {
    return fs.statSync(path.join(erdDir, file)).isDirectory();
  });

  let drawioCount = 0;
  let svgCount = 0;
  let pngCount = 0;
  let pdfCount = 0;

  for (const moduleName of modules) {
    const moduleDir = path.join(erdDir, moduleName);
    
    // Copy Draw.io XML if exists
    const drawioSrc = path.join(moduleDir, "er-diagram.drawio");
    if (fs.existsSync(drawioSrc)) {
      const drawioDest = path.join(downloadsDir, `${moduleName}.drawio`);
      fs.copyFileSync(drawioSrc, drawioDest);
      drawioCount++;
    }

    // Copy SVG if exists
    const svgSrc = path.join(moduleDir, "er-diagram.svg");
    if (fs.existsSync(svgSrc)) {
      const svgDest = path.join(downloadsDir, `${moduleName}.svg`);
      fs.copyFileSync(svgSrc, svgDest);
      svgCount++;
    }

    // Copy PNG if exists
    const pngSrc = path.join(moduleDir, "er-diagram.png");
    if (fs.existsSync(pngSrc)) {
      const pngDest = path.join(downloadsDir, `${moduleName}.png`);
      fs.copyFileSync(pngSrc, pngDest);
      pngCount++;
    }

    // Copy PDF if exists
    const pdfSrc = path.join(moduleDir, "er-diagram.pdf");
    if (fs.existsSync(pdfSrc)) {
      const pdfDest = path.join(downloadsDir, `${moduleName}.pdf`);
      fs.copyFileSync(pdfSrc, pdfDest);
      pdfCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Success! Exported diagram files to your PC:`);
  console.log(`- ${drawioCount} Draw.io editable file(s) (.drawio)`);
  console.log(`- ${svgCount} SVG file(s) (.svg)`);
  console.log(`- ${pngCount} High DPI PNG file(s) (.png)`);
  console.log(`- ${pdfCount} PDF file(s) (.pdf)`);
  console.log(`========================================`);
  console.log(`Folder path: ${downloadsDir}\n`);
}

main();
