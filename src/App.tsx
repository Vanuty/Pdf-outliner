import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, FileDown, BookOpen, Layers, RefreshCw, ZoomIn, 
  ZoomOut, ArrowLeft, ArrowRight, Settings, Sparkles, Cpu, 
  AlertCircle, FileText, CheckCircle, Sliders, Trash2, HelpCircle, X
} from "lucide-react";
import BookmarkTree from "./components/BookmarkTree";
import { writePDFOutlines } from "./utils/pdfOutlineWriter";
import { Bookmark, PDFMetadata, OutlineMode, AIStatus } from "./types";

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export default function App() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfjsDoc, setPdfjsDoc] = useState<any>(null);
  const [metadata, setMetadata] = useState<PDFMetadata | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([
    { id: "sample-1", title: "第一章 自然排版考前核心指南", pageNumber: 1, level: 1 },
    { id: "sample-2", title: "第一节 各种内科循环系统急症诊断", pageNumber: 4, level: 2 },
    { id: "sample-3", title: "第二节 经典临床思维与重点疾病模型", pageNumber: 11, level: 2 },
    { id: "sample-4", title: "第二章 历年实战真题精讲与还原", pageNumber: 25, level: 1 },
  ]);
  const [activePage, setActivePage] = useState<number>(1);
  const [offset, setOffset] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.2);
  const [isDragOver, setIsDragOver] = useState(false);

  // Tabs for AI Bookmark Mode
  const [aiTab, setAiTab] = useState<"toc" | "scan">("toc");
  
  // AI Settings
  const [tocPageRange, setTocPageRange] = useState("2-4");
  const [tocTextInput, setTocTextInput] = useState("");
  const [scanPageRange, setScanPageRange] = useState("1-15");
  const [scanMode, setScanMode] = useState<OutlineMode>("block");
  const [isIncrementalScan, setIsIncrementalScan] = useState<boolean>(true);
  const [promptGuide, setPromptGuide] = useState("");
  const [aiStatus, setAiStatus] = useState<AIStatus>({ loading: false, message: "" });
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.5-flash");
  
  // Custom elegant modal notifications
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [confirmBox, setConfirmBox] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  // Batch offset input
  const [batchOffsetInput, setBatchOffsetInput] = useState<string>("");

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  // Load standard initial states and cleanups
  useEffect(() => {
    if (pdfjsDoc) {
      renderActivePage();
    }
  }, [pdfjsDoc, activePage, zoom]);

  // Re-render canvas on page active and zoom triggers
  const renderActivePage = async () => {
    if (!pdfjsDoc || !canvasRef.current) return;
    try {
      const page = await pdfjsDoc.getPage(activePage);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      const viewport = page.getViewport({ scale: zoom });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err.name !== "RenderingCancelledException") {
        console.error("Render error:", err);
      }
    }
  };

  // Drag and Drop PDF File readers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      processFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      processFile(file);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // Parse original outlines and document metadata from PDF
  const processFile = (file: File) => {
    const reader = new FileReader();
    setAiStatus({ loading: true, message: "正在解析本地 PDF 文件，大文件请稍候..." });
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        
        // Clone the buffer to secure an independent copy for outlines compilation,
        // preventing pdf.js Web Workers from transferring and neutering the main buffer.
        const bytesForPdfLib = new Uint8Array(buffer.slice(0));
        const bytesForPdfJS = new Uint8Array(buffer);
        
        setPdfBytes(bytesForPdfLib);

        const pdfjsLib = window.pdfjsLib;
        const loadingTask = pdfjsLib.getDocument({ data: bytesForPdfJS });
        const doc = await loadingTask.promise;
        setPdfjsDoc(doc);

        // Automatically default page ranges based on uploaded PDF size
        const total = doc.numPages;
        setTocPageRange(`2-${Math.min(total, 5)}`);
        setScanPageRange(`1-${Math.min(total, 15)}`);

        setMetadata({
          fileName: file.name,
          fileSize: formatBytes(file.size),
          totalPages: total,
        });

        // Initialize active page
        setActivePage(1);

        // Attempt existing outline extraction
        await extractExistingOutlines(doc);
        setAiStatus({ loading: false, message: "" });
      } catch (err: any) {
        console.error(err);
        setAiStatus({ loading: false, message: `PDF解析失败: ${err.message}` });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const extractExistingOutlines = async (docJS: any) => {
    try {
      const pdfjsOutline = await docJS.getOutline();
      if (pdfjsOutline && pdfjsOutline.length > 0) {
        const resolveBookmarks = async (items: any[], level = 1): Promise<Bookmark[]> => {
          let res: Bookmark[] = [];
          for (const item of items) {
            let pageNum = 1;
            if (item.dest) {
              try {
                if (typeof item.dest === "string") {
                  const destArray = await docJS.getDestination(item.dest);
                  if (destArray && destArray[0]) {
                    const pageIndex = await docJS.getPageIndex(destArray[0]);
                    pageNum = pageIndex + 1;
                  }
                } else if (Array.isArray(item.dest) && item.dest[0]) {
                  const pageIndex = await docJS.getPageIndex(item.dest[0]);
                  pageNum = pageIndex + 1;
                }
              } catch (destErr) {
                console.error("Resolve destination item outline index failed:", destErr);
              }
            }
            res.push({
              id: Math.random().toString(36).substring(2, 9),
              title: item.title || "无标题书签",
              pageNumber: pageNum,
              level: level,
            });
            if (item.items && item.items.length > 0) {
              const children = await resolveBookmarks(item.items, level + 1);
              res = res.concat(children);
            }
          }
          return res;
        };

        const resolved = await resolveBookmarks(pdfjsOutline);
        if (resolved.length > 0) {
          setBookmarks(resolved);
        }
      } else {
        setBookmarks([]);
      }
    } catch (e) {
      console.error("Existing outline search skipped or empty:", e);
      setBookmarks([]);
    }
  };

  // Local PDF Text Extractors for direct Auto-pasting in AI mode
  const handleExtractTOCPages = async () => {
    if (!pdfjsDoc || !metadata) return;
    setAiStatus({ loading: true, message: "正在读取指定页面的文本内容..." });
    try {
      const pagesToExtract: number[] = [];
      const parts = tocPageRange.split("-");
      if (parts.length === 2) {
        const start = Math.max(1, parseInt(parts[0]));
        const end = Math.min(metadata.totalPages, parseInt(parts[1]));
        for (let p = start; p <= end; p++) {
          pagesToExtract.push(p);
        }
      } else {
        const single = parseInt(tocPageRange);
        if (!isNaN(single) && single >= 1 && single <= metadata.totalPages) {
          pagesToExtract.push(single);
        }
      }

      if (pagesToExtract.length === 0) {
        throw new Error("请输入合法的也码范围 (例如 2-4)");
      }

      let combinedText = "";
      for (const pageNum of pagesToExtract) {
        const page = await pdfjsDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        combinedText += `--- 物理第 ${pageNum} 页 ---\n${pageText}\n\n`;
      }

      setTocTextInput(combinedText);
      setAiStatus({ loading: false, message: "" });
    } catch (error: any) {
      setAiStatus({ loading: false, message: `文本读取失败: ${error.message}` });
    }
  };

  // Call Server-side API endpoints
  const handleGenerateFromTOC = async () => {
    if (!tocTextInput.trim()) {
      alert("目录原始文本区域为空，请提取或输入！");
      return;
    }
    setAiStatus({ loading: true, message: "AI 正在深度解构目录并确定层级结构..." });
    try {
      const res = await fetch("/api/gen-outline-from-toc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tocText: tocTextInput,
          userInstructions: promptGuide,
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.bookmarks && Array.isArray(data.bookmarks)) {
        const mapped: Bookmark[] = data.bookmarks.map((b: any) => ({
          id: Math.random().toString(36).substring(2, 9),
          title: b.title,
          pageNumber: b.pageNumber || 1, // original table numbering
          level: b.level || 1,
        }));

        setBookmarks(mapped);

        if (data.detectedOffset && typeof data.detectedOffset === "number" && data.detectedOffset !== 0) {
          setOffset(data.detectedOffset);
        }

        let successMessage = `🎉 成功解析并自动生成了 ${mapped.length} 个层级书签！自动纠偏所得偏置量为: ${data.detectedOffset || 0}。`;
        if (data.fallbackCount && data.fallbackCount > 0) {
          successMessage += ` (由于选定的 ${selectedModel} 模型额度超出/负载过高，系统已为您自动秒级切换至备份引擎 ${data.usedModel})`;
          showToast(`⚠️ 已自动通过备份引擎 [${data.usedModel}] 重新构建书签！`, "info");
        } else {
          showToast(`已成功使用模型 ${data.usedModel || selectedModel} 完成目录解析目录！`, "success");
        }

        setAiStatus({ 
          loading: false, 
          message: successMessage 
        });
      } else {
        throw new Error("AI未能输出符合规范的书签数据格式");
      }
    } catch (error: any) {
      setAiStatus({ loading: false, message: `AI 目录解析失败: ${error.message}` });
    }
  };

  const handleScanPagesAI = async () => {
    if (!pdfjsDoc || !metadata) return;
    setAiStatus({ loading: true, message: "正在读取选定页面范围的数据切片..." });
    try {
      let pagesToScan: number[] = [];
      const parts = scanPageRange.split("-");
      if (parts.length === 2) {
        const start = Math.max(1, parseInt(parts[0]));
        const end = Math.min(metadata.totalPages, parseInt(parts[1]));
        for (let p = start; p <= end; p++) {
          pagesToScan.push(p);
        }
      } else {
        const single = parseInt(scanPageRange);
        if (!isNaN(single) && single >= 1 && single <= metadata.totalPages) {
          pagesToScan.push(single);
        }
      }

      if (pagesToScan.length === 0) {
        throw new Error("有效扫描页面区间输入有误，请确保输入如 2-119 的合法范围。");
      }

      // If incremental scan mode is active, filter out pages that already have bookmarks
      if (isIncrementalScan) {
        const existingPhysicalPages = new Set(bookmarks.map(b => b.pageNumber + offset));
        pagesToScan = pagesToScan.filter(p => !existingPhysicalPages.has(p));

        if (pagesToScan.length === 0) {
          setAiStatus({ loading: false, message: "" });
          showToast("选定范围内的所有页面都已存在书签，无需重复添加扫描！", "info");
          return;
        }
      }

      const BATCH_SIZE = 30;
      const totalPagesToScan = pagesToScan.length;
      let allMappedBookmarks: Bookmark[] = [];
      let totalExtractedCharCount = 0;
      let hasFallback = false;
      let lastUsedModel = selectedModel;

      for (let i = 0; i < totalPagesToScan; i += BATCH_SIZE) {
        const batchPages = pagesToScan.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(totalPagesToScan / BATCH_SIZE);

        setAiStatus({ 
          loading: true, 
          message: `正在提取页面文本与预览 [批次 ${batchNum}/${totalBatches}, 进度 ${Math.round((i / totalPagesToScan) * 100)}%]...` 
        });

        const summaries: Array<{ pageNumber: number; text: string }> = [];
        for (const p of batchPages) {
          const page = await pdfjsDoc.getPage(p);
          const textContent = await page.getTextContent();
          const rawText = textContent.items.map((item: any) => item.str || "").join(" ").trim();
          totalExtractedCharCount += rawText.length;
          
          summaries.push({
            pageNumber: p,
            text: rawText.slice(0, 450), // extract first 450 characters as brief preview
          });
        }

        // Help user if it is a pure image (non-OCR) scanned PDF
        if (i === 0 && totalExtractedCharCount === 0) {
          throw new Error("检测到前几个页面没有任何明文文字（该 PDF 可能属于未做 OCR 文字识别的“纯图片扫描版”书本）。在无 OCR 文本状态下，AI 无法提取章节或段落。您可以转换使用【解析有目录 PDF】功能，手动或将目录文字粘贴到输入框来实现全自动解析和深度对齐！");
        }

        setAiStatus({ 
          loading: true, 
          message: `AI 正在对指定页面进行智能段落与章节大纲分析 [批次 ${batchNum}/${totalBatches}]...` 
        });

        const res = await fetch("/api/gen-outline-from-pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: summaries,
            mode: scanMode,
            userInstructions: promptGuide,
            model: selectedModel,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          let errMessage = "服务器内部错误";
          try {
            const errJson = JSON.parse(text);
            errMessage = errJson.error || errMessage;
          } catch {
            errMessage = text.slice(0, 100) || res.statusText;
          }
          throw new Error(errMessage);
        }

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.fallbackCount && data.fallbackCount > 0) {
          hasFallback = true;
          lastUsedModel = data.usedModel;
        }

        if (data.bookmarks && Array.isArray(data.bookmarks)) {
          let mapped: Bookmark[] = data.bookmarks.map((b: any) => ({
            id: Math.random().toString(36).substring(2, 9),
            title: b.title,
            // Since pages already has physical pageNumber, subtract current offset
            // so when displayed (pageNumber + offset) it maps precisely to b.pageNumber!
            pageNumber: Math.max(1, b.pageNumber - offset),
            level: b.level || 1,
          }));

          // Strict double check: prevent duplicate bookmarks pointing to the same page
          if (isIncrementalScan) {
            const existingPageNumbers = new Set(bookmarks.map(b => b.pageNumber));
            mapped = mapped.filter(b => !existingPageNumbers.has(b.pageNumber));
          }

          allMappedBookmarks = [...allMappedBookmarks, ...mapped];
        }
      }

      if (allMappedBookmarks.length > 0) {
        setBookmarks((prev) => {
          const appended = [...prev, ...allMappedBookmarks];
          const sorted = appended.sort((x, y) => x.pageNumber - y.pageNumber);
          
          // Apply automatic hierarchy level-smoothing optimizer (no indentation jumps)
          if (sorted.length > 0) {
            if (sorted[0].level > 1) {
              sorted[0] = { ...sorted[0], level: 1 };
            }
            for (let i = 1; i < sorted.length; i++) {
              const prevL = sorted[i - 1].level;
              const currL = sorted[i].level;
              if (currL > prevL + 1) {
                sorted[i] = { ...sorted[i], level: prevL + 1 };
              }
            }
          }
          return sorted;
        });

        // Set active preview page to the first generated AI bookmark page
        setActivePage(Math.max(1, Math.min(metadata.totalPages, allMappedBookmarks[0].pageNumber + offset)));

        let successMsg = `🎉 AI 智能书签大纲增量补充成功！一键补录了新的 ${allMappedBookmarks.length} 个非重复书签节点。`;
        if (hasFallback) {
          successMsg += ` (其中部分页面批次由于 ${selectedModel} 超额，已自动为您平滑切换为备用模型 ${lastUsedModel})`;
          showToast(`⚠️ 部分分析批次自动切换备份模型完成! [${lastUsedModel}]`, "info");
        } else {
          showToast(`大纲增量补充成功！全流程运行在 ${selectedModel}！`, "success");
        }

        setAiStatus({ 
          loading: false, 
          message: successMsg 
        });
      } else {
        throw new Error(isIncrementalScan 
          ? "AI 扫描完毕，但未提取到任何新的不重复章节或段落，新提取节点全被已有页面覆盖。"
          : "AI 分析完毕，但未能正常抽取出任何书签节点，请调整参数、增加偏好说明或换个页面范围试试。"
        );
      }
    } catch (e: any) {
      setAiStatus({ loading: false, message: `智能扫描失败: ${e.message}` });
    }
  };

  // Interactive bookmark tree modification callbacks
  const handleUpdateBookmark = (id: string, updated: Partial<Bookmark>) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updated } : b))
    );
  };

  const handleDeleteBookmark = (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  const handleMoveBookmark = (index: number, direction: "up" | "down") => {
    setBookmarks((prev) => {
      const nextArr = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < nextArr.length) {
        // Swap
        const current = nextArr[index];
        nextArr[index] = nextArr[targetIndex];
        nextArr[targetIndex] = current;
      }
      return nextArr;
    });
  };

  const handleAddBookmarkAt = (index: number) => {
    const defaultPage = bookmarks[index] 
      ? bookmarks[index].pageNumber 
      : Math.max(1, activePage - offset);
    const defaultLevel = bookmarks[index] ? bookmarks[index].level : 1;

    const newBookmark: Bookmark = {
      id: Math.random().toString(36).substring(2, 9),
      title: "新自定义节点",
      pageNumber: defaultPage,
      level: defaultLevel,
    };

    setBookmarks((prev) => {
      const nextArr = [...prev];
      nextArr.splice(index + 1, 0, newBookmark);
      return nextArr;
    });
  };

  // Batch actions on bookmarks
  const handleSmoothLevels = () => {
    setBookmarks((prev) => {
      if (prev.length === 0) return prev;
      const sorted = [...prev].sort((x, y) => x.pageNumber - y.pageNumber);
      if (sorted[0].level > 1) {
        sorted[0] = { ...sorted[0], level: 1 };
      }
      for (let i = 1; i < sorted.length; i++) {
        const prevL = sorted[i - 1].level;
        const currL = sorted[i].level;
        if (currL > prevL + 1) {
          sorted[i] = { ...sorted[i], level: prevL + 1 };
        }
      }
      return sorted;
    });
    showToast("🎉 智能层级规格矫正成功！已修复所有层级阶梯跳跃，缩进关系过渡平滑到位！", "success");
  };

  const clearAllBookmarks = () => {
    setConfirmBox({
      message: "确定要一键清空所有书签吗？这会让你重新设计或者重新导入全部节点大纲。",
      onConfirm: () => {
        setBookmarks([]);
        showToast("已清空当前所有书签大纲", "success");
      }
    });
  };

  // Bookmark pages global offset shifting
  const applyGlobalOffsetShift = () => {
    const shiftVal = parseInt(batchOffsetInput);
    if (isNaN(shiftVal)) {
      showToast("请输入有效的偏移整数数字", "error");
      return;
    }
    setBookmarks(prev => 
      prev.map(b => ({
        ...b,
        pageNumber: Math.max(1, b.pageNumber + shiftVal)
      }))
    );
    showToast(`已批量将全部书签的原始页码移动了 ${shiftVal > 0 ? "+" : ""}${shiftVal} 页`, "success");
    setBatchOffsetInput("");
  };

  const handleExportPDF = async () => {
    if (!pdfBytes || !metadata) return;
    setAiStatus({ loading: true, message: "正在对原始 PDF 二进制执行书签层级和偏移编译..." });
    try {
      // Offset applies: physical page num = pageNumber + offset
      const compiledBookmarks: Bookmark[] = bookmarks.map(b => ({
        ...b,
        // Calculate shifted position
        pageNumber: Math.max(1, b.pageNumber + offset)
      }));

      const finalPdfBytes = await writePDFOutlines(pdfBytes, compiledBookmarks);
      
      // Save trigger using Browser Download BLOB
      const blob = new Blob([finalPdfBytes], { type: "application/pdf" });
      const downloadName = metadata.fileName.replace(/\.pdf$/i, "") + "_outlined.pdf";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      link.click();
      setAiStatus({ loading: false, message: "" });
    } catch (err: any) {
      console.error(err);
      setAiStatus({ loading: false, message: `PDF 导出失败: ${err.message}` });
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-natural-bg text-natural-text font-sans" id="applet-viewport">
      {/* Top Bar Navigation */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-natural-border" id="app-header">
        <div className="flex items-center gap-2">
          <BookOpen className="text-natural-accent shrink-0" size={20} />
          <h1 className="text-base font-bold tracking-tight text-natural-text font-sans select-none">
            Pdf-outliner <span className="font-serif italic text-xs text-[#8E8E88] ml-2">智能 PDF 书签生成器</span>
          </h1>
        </div>

        {/* Global Loading Indicator */}
        {aiStatus.loading && (
          <div className="flex items-center text-xs text-natural-text gap-2 bg-natural-bg border border-natural-border py-1.5 px-4 rounded-lg animate-pulse shadow-xs">
            <RefreshCw size={12} className="animate-spin text-natural-accent" />
            <span className="font-medium">{aiStatus.message}</span>
          </div>
        )}

        {/* Action button */}
        {pdfjsDoc && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 text-xs px-4 py-2 bg-natural-accent hover:opacity-90 font-medium text-white rounded-lg shadow-md hover:cursor-pointer transition-all"
              id="export-pdf-button"
            >
              <FileDown size={14} /> 导出 outlined 书签 PDF
            </button>
          </div>
        )}
      </header>

      {/* Main Workspace Workspace */}
      {true ? (
        <div className="flex-1 flex overflow-hidden w-full" id="workspace-layout">
          
          {/* Left panel wrapper with strict overflow control to avoid cutoff */}
          <div className="w-[340px] h-full overflow-hidden flex flex-col shrink-0 border-r border-natural-border bg-white" id="left-sidebar">
            <div className="flex-1 overflow-y-auto p-5 space-y-6" id="left-sidebar-controls">
            
            {/* 1. PDF File Metadata Display */}
            <div className="bg-natural-bg p-3.5 rounded-lg border border-natural-border/60" id="metadata-box">
              <h2 className="text-xs font-semibold text-natural-text flex items-center gap-1.5 mb-2.5">
                <FileText size={13.5} className="text-natural-accent" /> 文件概要属性
              </h2>
              <div className="space-y-1 text-xs text-natural-text/80">
                {metadata ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[#8E8E88] truncate max-w-[130px]" title={metadata.fileName}>名称:</span>
                      <span className="font-medium text-natural-text select-all truncate max-w-[150px]">{metadata.fileName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8E8E88]">大小:</span>
                      <span className="font-mono text-natural-text/90">{metadata.fileSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8E8E88]">总页数:</span>
                      <span className="font-mono text-natural-text font-bold">{metadata.totalPages} 页</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-1.5 text-[11px] text-[#8E8E88]/80 font-serif italic">
                    待加载本地 PDF 属性
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#8E8E88]">书签:</span>
                  <span className="text-natural-text font-medium">{bookmarks.length} 个</span>
                </div>
              </div>
            </div>

            {/* 2. Page Offset correction Controller */}
            <div className="border border-natural-border p-4 rounded-lg space-y-3.5 bg-white shadow-xs" id="offset-block">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-natural-text flex items-center gap-1.5">
                  <Sliders size={13.5} className="text-natural-accent" /> 目录页码偏移矫正
                </h2>
                <span className="text-[10px] text-natural-accent bg-natural-bg border border-natural-border px-2 py-0.5 rounded shadow-sm font-mono font-bold">
                  当前偏移：{offset}
                </span>
              </div>
              <p className="text-[11px] text-natural-text/60 leading-normal">
                说明：由于封面、前言等导致目录页码与实际 PDF 页面不同（如目录写第 15 页，实际为第 22 页），此处调节偏移值为 <span className="font-bold underline text-natural-accent">+7</span>。
              </p>

              {/* Offset Adjuster Inputs */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(prev => prev - 1)}
                  className="w-8 h-8 flex items-center justify-center bg-natural-bg hover:bg-natural-aside/70 border border-natural-border rounded-lg font-bold text-natural-text transition-all cursor-pointer"
                  title="递减偏移 (-1)"
                >
                  -
                </button>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={offset}
                    onChange={(e) => setOffset(parseInt(e.target.value) || 0)}
                    className="w-full text-center text-xs h-8 bg-natural-bg border border-natural-border rounded-lg text-natural-text focus:outline-none focus:ring-1 focus:ring-natural-accent"
                    placeholder="输入偏移值, 如 +7"
                  />
                </div>
                <button
                  onClick={() => setOffset(prev => prev + 1)}
                  className="w-8 h-8 flex items-center justify-center bg-natural-bg hover:bg-natural-aside/70 border border-natural-border rounded-lg font-bold text-natural-text transition-all cursor-pointer"
                  title="递增偏移 (+1)"
                >
                  +
                </button>
              </div>

              {/* Reset offset */}
              <button
                onClick={() => setOffset(0)}
                className="w-full block py-1 border border-transparent rounded bg-transparent hover:bg-natural-bg text-[10px] text-[#8E8E88] text-center transition-all cursor-pointer font-medium"
              >
                重置偏移为 0
              </button>
            </div>

            {/* 3. AI Bookmarks Generator Panel */}
            <div className="border border-natural-border rounded-lg overflow-hidden bg-white shadow-xs" id="ai-generator-panel">
              <div className="p-3 bg-natural-bg border-b border-natural-border flex items-center gap-1.5 text-xs font-semibold text-natural-text">
                <Sparkles size={14} className="text-natural-accent fill-natural-accent/15" />
                <span className="font-serif italic text-sm">AI 智能大纲/书签方案组</span>
              </div>

              {/* Tabs for AI approach */}
              <div className="flex bg-natural-bg border-b border-natural-border text-xs text-center p-1 rounded-md m-2">
                <button
                  onClick={() => setAiTab("toc")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    aiTab === "toc"
                      ? "bg-white shadow-sm text-natural-text"
                      : "text-natural-text/60 hover:text-natural-text"
                  }`}
                >
                  解析有目录 PDF
                </button>
                <button
                  onClick={() => setAiTab("scan")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    aiTab === "scan"
                      ? "bg-white shadow-sm text-natural-text"
                      : "text-natural-text/60 hover:text-natural-text"
                  }`}
                >
                  扫描无目录 PDF
                </button>
              </div>

              {/* Mode Sub-contents */}
              <div className="p-3.5 space-y-4">
                
                {aiTab === "toc" ? (
                  /* Parsing Existing printed TOC pages */
                  <div className="space-y-3">
                    <p className="text-[11px] text-natural-text/60 leading-normal font-sans">
                      模式：输入 PDF 中的真实目录文本。AI 将智能分离级标题、自动提取原始页码并纠错。
                    </p>
                    
                    {/* Page ranges extraction helper */}
                    <div className="space-y-2.5 bg-[#fcfcfc] p-2.5 rounded border border-natural-border">
                      <div className="flex items-center justify-between text-[11px] text-natural-text/70">
                        <span>提取 PDF 的目录页</span>
                        <span className="text-[10px] text-natural-text/45 font-mono">起-止</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={tocPageRange}
                          onChange={(e) => setTocPageRange(e.target.value)}
                          placeholder="如 2-4"
                          className="flex-1 text-xs px-2.5 h-8 bg-natural-bg border border-natural-border rounded-lg text-natural-text focus:outline-none focus:ring-1 focus:ring-natural-accent"
                        />
                        <button
                          onClick={handleExtractTOCPages}
                          className="px-2.5 h-8 text-[11px] font-sans font-medium bg-white border border-natural-border text-natural-text hover:bg-natural-bg rounded-lg transition-all cursor-pointer"
                        >
                          提取
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-natural-text/80">目录文本区域:</label>
                      <textarea
                        value={tocTextInput}
                        onChange={(e) => setTocTextInput(e.target.value)}
                        placeholder="粘贴目录，或使用'开始提取'一键把PDF中的目录页文字拉来这里..."
                        className="w-full h-32 text-xs p-2.5 bg-natural-bg border border-natural-border rounded-lg focus:outline-none focus:ring-1 focus:ring-natural-accent resize-none font-mono text-natural-text placeholder-natural-text/45"
                      />
                    </div>

                    <button
                      onClick={handleGenerateFromTOC}
                      className="w-full py-2 text-xs bg-natural-accent text-white font-medium hover:opacity-90 rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Cpu size={12} /> AI 解析生成并自动纠偏
                    </button>
                  </div>
                ) : (
                  /* AI Page Scanning for Sparse books */
                  <div className="space-y-3.5">
                    <p className="text-[11px] text-natural-text/60 leading-normal font-sans">
                      模式：PDF 没有任何目录，让 AI 分析指定范围的所有页面文字，推理章节切换点和书签标题。
                    </p>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-natural-text/80">需要分析的物理页面范围:</label>
                      <input
                        type="text"
                        value={scanPageRange}
                        onChange={(e) => setScanPageRange(e.target.value)}
                        placeholder="输入如 1-15, 限50页以内"
                        className="w-full text-xs px-2.5 py-1.5 bg-natural-bg border border-natural-border rounded-lg focus:outline-none focus:ring-1 focus:ring-natural-accent text-natural-text"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-natural-text/80">AI 智能决策模式:</label>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button
                          onClick={() => setScanMode("block")}
                          className={`py-1.5 border rounded-lg transition-all text-center cursor-pointer ${
                            scanMode === "block"
                              ? "bg-natural-accent border-transparent text-white font-semibold shadow-xs"
                              : "bg-white border-natural-border text-natural-text/60 hover:text-natural-text"
                          }`}
                        >
                          章节段落块模式
                        </button>
                        <button
                          onClick={() => setScanMode("single")}
                          className={`py-1.5 border rounded-lg transition-all text-center cursor-pointer ${
                            scanMode === "single"
                              ? "bg-natural-accent border-transparent text-white font-semibold shadow-xs"
                              : "bg-white border-natural-border text-natural-text/60 hover:text-natural-text"
                          }`}
                        >
                          极致单页标题模式
                        </button>
                      </div>
                      <p className="text-[10px] text-[#8E8E88] leading-normal font-sans">
                        章节块适合教材文献，按内容自动聚拢。单页模式适合讲义及PPT。
                      </p>
                    </div>

                    {/* Incremental Scan Mode Option */}
                    <div className="flex flex-col gap-1.5 p-2.5 rounded-lg border border-natural-border bg-natural-bg/50">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="is-incremental-scan"
                          checked={isIncrementalScan}
                          onChange={(e) => setIsIncrementalScan(e.target.checked)}
                          className="h-4 w-4 rounded border-natural-border text-natural-accent focus:ring-natural-accent cursor-pointer accent-natural-accent"
                        />
                        <label htmlFor="is-incremental-scan" className="text-[11px] font-bold text-natural-text cursor-pointer select-none">
                          无损主页增量/再次扫描补充模式
                        </label>
                      </div>
                      <p className="text-[10px] text-[#8E8E88] leading-normal font-sans pl-6">
                        自动跳过已有书签的物理页面，提取缺漏页并拼接新章节，防止同页重复生成。
                      </p>
                    </div>

                    <button
                      onClick={handleScanPagesAI}
                      className="w-full py-2 text-xs bg-natural-accent text-white font-medium hover:opacity-90 rounded-lg transition-all flex items-center justify-center gap-1.2 shadow-sm cursor-pointer"
                    >
                      <Cpu size={12} /> 一键启动 AI 再次扫描补充
                    </button>
                  </div>
                )}

                {/* Shared prompt tuning guide option */}
                <div className="border-t border-natural-border pt-3.5 space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-natural-text/80">
                    <Settings size={11} className="text-natural-accent" /> 
                    <span>个性化 AI 微调偏好 (可选)</span>
                  </div>
                  <input
                    type="text"
                    value={promptGuide}
                    onChange={(e) => setPromptGuide(e.target.value)}
                    placeholder="如“仅提取两级结构”、“限定生成医学相关的术语”"
                    className="w-full text-xs px-2.5 py-1.5 bg-natural-bg border border-natural-border rounded-lg focus:outline-none focus:ring-1 focus:ring-natural-accent text-natural-text placeholder-natural-text/45"
                  />
                </div>

                {/* AI Model Selection with Auto-Fallback */}
                <div className="border-t border-natural-border pt-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-natural-text/80">
                    <div className="flex items-center gap-1">
                      <Cpu size={11} className="text-natural-accent" /> 
                      <span>AI 多模态大模型选择 (带有防超额自动切换)</span>
                    </div>
                  </div>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 bg-natural-bg border border-natural-border rounded-lg focus:outline-none focus:ring-1 focus:ring-natural-accent text-natural-text cursor-pointer font-medium"
                    id="model-selector-dropdown"
                  >
                    <option value="gemini-3.5-flash">gemini-3.5-flash (默认高精多模态)</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (轻量省额备用型)</option>
                    <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (高阶全能推理型)</option>
                  </select>
                  <p className="text-[9.5px] text-[#8E8E88] leading-normal font-sans">
                    * 遇到免费 API 限额(429)或繁忙(503)时，系统会自动在后台平滑切换至其他健康模型重试，极速保障任务顺利完成。
                  </p>
                </div>

                {/* Local AI Result and Error Status Box */}
                {aiStatus.message && (
                  <div className={`text-[11px] p-3 rounded-lg border flex items-start gap-2 transition-all ${
                    aiStatus.loading
                      ? "bg-amber-50/70 border-amber-200 text-amber-800 animate-pulse"
                      : aiStatus.message.startsWith("🎉")
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800 font-medium"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`} id="ai-status-panel">
                    {aiStatus.loading ? (
                      <RefreshCw size={13} className="animate-spin mt-0.5 shrink-0 text-amber-600" />
                    ) : aiStatus.message.startsWith("🎉") ? (
                      <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald-600" strokeWidth={2.5} />
                    ) : (
                      <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-600" strokeWidth={2.5} />
                    )}
                    <span className="flex-1 leading-normal select-text text-left">{aiStatus.message}</span>
                  </div>
                )}

              </div>
            </div>

            {/* 4. Batch Operations Panel */}
            <div className="border border-natural-border p-4 rounded-lg bg-white space-y-3 shadow-xs" id="batch-editor-panel">
              <h2 className="text-xs font-semibold text-natural-text flex items-center gap-1.5">
                <Sliders size={13.5} className="text-natural-accent" /> 高级批量操作
              </h2>
              
              {/* Shifting overall item printed page numbers */}
              <div className="space-y-1.5 bg-natural-bg p-2.5 rounded-lg border border-natural-border/50">
                <span className="text-[10px] block text-natural-text/60 leading-normal">想批量把所有书签的物理对应位（例如 P.16）统一右移或左移，免去逐个调整：</span>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={batchOffsetInput}
                    onChange={(e) => setBatchOffsetInput(e.target.value)}
                    placeholder="偏移量 (如 +2 或 -3)"
                    className="flex-1 text-xs px-2.5 bg-white border border-natural-border rounded-lg text-natural-text focus:outline-none focus:ring-1 focus:ring-natural-accent"
                  />
                  <button
                    onClick={applyGlobalOffsetShift}
                    className="px-2.5 py-1 text-[11px] bg-natural-accent text-white hover:opacity-95 font-medium rounded-lg transition-all shrink-0 cursor-pointer"
                    title="应用偏移"
                  >
                    应用
                  </button>
                </div>
              </div>

              {/* Resetting bookmarks to blank state */}
              <button
                onClick={clearAllBookmarks}
                disabled={bookmarks.length === 0}
                className="w-full py-1.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-medium rounded-lg transition-all disabled:opacity-20 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={12.5} /> 清空当前所有书签大纲
              </button>

              {/* Restoring default example outline */}
              <button
                onClick={() => {
                  setBookmarks([
                    { id: "sample-1", title: "第一章 自然排版考前核心指南", pageNumber: 1, level: 1 },
                    { id: "sample-2", title: "第一节 各种内科循环系统急症诊断", pageNumber: 4, level: 2 },
                    { id: "sample-3", title: "第二节 经典临床思维与重点疾病模型", pageNumber: 11, level: 2 },
                    { id: "sample-4", title: "第二章 历年实战真题精讲与还原", pageNumber: 25, level: 1 },
                  ]);
                  showToast("已重置并载入默认示例书签！", "success");
                }}
                className="w-full py-1.5 text-xs border border-natural-border text-natural-text hover:bg-natural-bg font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={12.5} className="text-natural-accent" /> 恢复默认示例书签
              </button>
            </div>

            </div> {/* left-sidebar-controls */}
          </div> {/* left-sidebar */}

          {/* Center viewport panel: Interactive PDF reader canvas */}
          <div className="flex-1 flex flex-col bg-natural-border/50 overflow-hidden relative" id="center-pdf-viewer">
            
            {pdfjsDoc ? (
              <>
                {/* Context Actions top control board */}
                <div className="h-12 bg-white border-b border-natural-border px-6 flex items-center justify-between shadow-sm shrink-0">
                  
                  {/* Jumping page and arrows */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActivePage(prev => Math.max(1, prev - 1))}
                      disabled={activePage <= 1}
                      className="p-1 text-natural-text/45 hover:text-natural-accent hover:bg-natural-bg rounded disabled:opacity-20 cursor-pointer"
                      title="上一页"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div className="flex items-center gap-1.5 text-xs text-natural-text/80">
                      <span>真实 PDF 物理页：</span>
                      <input
                        type="number"
                        value={activePage}
                        onChange={(e) => setActivePage(metadata ? Math.min(metadata.totalPages, Math.max(1, parseInt(e.target.value) || 1)) : Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-12 text-center py-0.5 border border-natural-border bg-natural-bg focus:outline-none focus:ring-1 focus:ring-natural-accent text-natural-text font-bold font-mono rounded-lg"
                      />
                      <span>/ {metadata ? metadata.totalPages : "?"}</span>
                    </div>
                    <button
                      onClick={() => setActivePage(prev => metadata ? Math.min(metadata.totalPages, prev + 1) : prev + 1)}
                      disabled={metadata ? activePage >= metadata.totalPages : true}
                      className="p-1 text-natural-text/45 hover:text-natural-accent hover:bg-natural-bg rounded disabled:opacity-20 cursor-pointer"
                      title="下一页"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>

                  {/* Target Page mapping description */}
                  <div className="text-[11px] text-natural-text/60 bg-natural-bg border border-natural-border py-1 px-3.5 rounded-lg max-w-[280px] truncate">
                    映射书籍页编号: <span className="font-bold font-mono text-natural-accent">{activePage - offset}</span> 
                    <span className="mx-2 text-natural-border">|</span> 
                    物理真实页: <span className="font-bold font-mono text-natural-text">{activePage}</span>
                  </div>

                  {/* Adjust Scales zoom controls */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setZoom(prev => Math.max(0.5, prev - 0.1))}
                      className="p-1.5 text-natural-text/60 hover:text-natural-accent hover:bg-natural-bg rounded cursor-pointer"
                      title="缩小"
                    >
                      <ZoomOut size={15} />
                    </button>
                    <span className="text-xs bg-natural-bg text-natural-accent border border-natural-border/70 px-2.5 py-0.5 rounded-lg font-mono select-none">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={() => setZoom(prev => Math.min(3.0, prev + 0.1))}
                      className="p-1.5 text-natural-text/60 hover:text-natural-accent hover:bg-natural-bg rounded cursor-pointer"
                      title="放大"
                    >
                      <ZoomIn size={15} />
                    </button>
                  </div>

                </div>

                {/* Document display viewport container */}
                <div className="flex-1 overflow-auto p-8 flex justify-center items-start font-sans" id="canvas-scroll-container">
                  <div className="bg-white shadow-2xl rounded-sm border border-natural-border p-2 relative transition-transform">
                    <canvas ref={canvasRef} className="max-w-full block" id="pdf-rendering-canvas" />
                    
                    {/* Visual subtle watermark or page overlay label */}
                    <div className="absolute top-4 left-4 bg-natural-accent/50 select-none text-white text-[10px] px-2.5 py-0.5 rounded-md font-mono font-bold backdrop-blur-xs shadow-sm">
                      Physical Page {activePage}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Drag & Drop Zone inside the center viewer if no PDF */
              <div 
                className={`flex-1 flex flex-col justify-center items-center transition-all p-8 bg-natural-bg ${
                  isDragOver ? "bg-[#E6E6DC] border-2 border-dashed border-natural-accent" : ""
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                id="landing-drop-zone"
              >
                {/* Landing panel container */}
                <div className="max-w-md w-full text-center space-y-6 bg-white p-10 rounded-2xl border border-natural-border shadow-md animate-fade-in animate-bounce">
                  
                  {/* Central Visual Logo */}
                  <div className="mx-auto w-16 h-16 bg-natural-aside border border-natural-border text-natural-accent rounded-2xl flex items-center justify-center shadow-xs">
                    <Upload size={28} className="text-natural-accent stroke-[1.5]" />
                  </div>

                  {/* Greetings */}
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold tracking-tight text-natural-text font-serif italic">
                      导入本地 PDF 文件启动大纲预览
                    </h2>
                    <p className="text-xs text-natural-text/65 leading-relaxed font-sans">
                      拖放物理 PDF 讲义、学习笔记至此区域即可启动对齐模式！或者，您也可以直接在左侧粘贴您的课程大纲文本，点击「AI 解析生成」直接自动拟合构建。
                    </p>
                  </div>

                  {/* Selecting input button */}
                  <div>
                    <label 
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-natural-accent text-white rounded-lg text-xs font-semibold hover:opacity-90 cursor-pointer shadow-md transition-all"
                    >
                      选择本地 PDF 文件
                      <input 
                        type="file" 
                        accept="application/pdf" 
                        onChange={handleFileChange} 
                        className="hidden" 
                      />
                    </label>
                    <span className="block text-[11px] text-natural-text/45 mt-2.5">
                      配合自动偏置对齐：纠正物理页码与打印页码的偏差
                    </span>
                  </div>

                </div>
              </div>
            )}

          </div>

          {/* Right viewport panel: Interactive Bookmark tree editor */}
          <div className="w-[380px] h-full overflow-hidden flex flex-col shrink-0" id="right-sidebar-outliner">
            <BookmarkTree
              bookmarks={bookmarks}
              activePage={activePage}
              offset={offset}
              onUpdateBookmark={handleUpdateBookmark}
              onDeleteBookmark={handleDeleteBookmark}
              onGoToPage={(pageVal) => {
                if (metadata) {
                  setActivePage(Math.max(1, Math.min(metadata.totalPages, pageVal)));
                } else {
                  setActivePage(Math.max(1, pageVal));
                }
              }}
              onMoveBookmark={handleMoveBookmark}
              onAddBookmarkAt={handleAddBookmarkAt}
              onSmoothLevels={handleSmoothLevels}
            />
          </div>

        </div>
      ) : null}

      {/* Global Status Footer */}
      <footer className="h-10 bg-natural-accent text-[#F5F5F0] px-6 flex justify-between items-center text-[11px] font-sans select-none shrink-0" id="app-footer">
        <div className="flex items-center gap-4">
          <div className="flex space-x-1 items-center">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
            <div className="w-1.5 h-1.5 bg-white/40 rounded-full"></div>
          </div>
          <span className="font-semibold tracking-wide">
            状态：{pdfjsDoc ? "✅ PDF 载入成功 | 自然排版纠偏就绪" : "等待导入本地 PDF 文件评估大纲..."}
          </span>
        </div>
        <div className="opacity-75">
          AI 解析引擎: <span className="font-serif italic text-[#F5F5F0] font-bold">Gemini Pro</span> & pdf-lib
        </div>
      </footer>

      {/* Custom elegant Toast notification */}
      {toast && (
        <div className="fixed bottom-14 right-6 p-4 rounded-xl shadow-xl border flex items-center gap-2.5 max-w-sm z-[999] transition-all bg-white border-natural-border animate-fade-in animate-bounce">
          <div className="shrink-0">
            {toast.type === "success" ? (
              <CheckCircle className="text-emerald-500" size={18} />
            ) : toast.type === "error" ? (
              <AlertCircle className="text-red-500" size={18} />
            ) : (
              <Sparkles className="text-natural-accent" size={18} />
            )}
          </div>
          <div className="text-xs font-medium text-natural-text">
            {toast.message}
          </div>
          <button onClick={() => setToast(null)} className="text-natural-text/40 hover:text-natural-text ml-auto shrink-0 p-1 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Custom elegant Dialog modal for Confirm actions */}
      {confirmBox && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 z-[999] transition-all animate-fade-in">
          <div className="bg-white border border-natural-border p-6 rounded-xl shadow-2xl max-w-sm w-full space-y-4">
            <div className="flex items-center gap-2.5 text-natural-text">
              <div className="bg-amber-50 p-2 rounded-lg border border-amber-200 shrink-0">
                <AlertCircle className="text-amber-600" size={18} />
              </div>
              <h3 className="font-serif italic text-base font-bold">操作需要确认</h3>
            </div>
            <p className="text-xs text-[#5C5C54] leading-relaxed">
              {confirmBox.message}
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmBox(null)}
                className="px-4 py-2 hover:bg-natural-bg text-natural-text text-xs font-semibold rounded-lg border border-natural-border transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => {
                  try {
                    confirmBox.onConfirm();
                  } catch (e: any) {
                    showToast(e.message, "error");
                  }
                  setConfirmBox(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-all shadow-sm cursor-pointer"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
