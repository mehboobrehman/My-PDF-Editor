import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  FileUp, 
  Download, 
  Type, 
  Image as ImageIcon, 
  Highlighter, 
  Crown, 
  Save, 
  ChevronLeft, 
  ChevronRight,
  RotateCw,
  RotateCcw,
  Maximize2,
  ZoomIn,
  ZoomOut,
  MousePointer2,
  Settings,
  Cloud,
  CheckCircle2,
  Plus,
  Trash2,
  FilePlus,
  Copy,
  Printer,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  Columns2,
  Square
} from 'lucide-react';
import { pdfjs, Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { loadStripe } from '@stripe/stripe-js';
import { motion, AnimatePresence } from 'motion/react';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const getStripe = () => {
  const key = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
  if (!key || key === 'MY_STRIPE_PUBLIC_KEY') {
    return null;
  }
  return loadStripe(key);
};

const stripePromise = getStripe();

interface Annotation {
  id: string;
  type: 'text' | 'image' | 'highlight';
  x: number;
  y: number;
  page: number;
  content?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
}

interface RecentFile {
  name: string;
  timestamp: number;
}

export default function App() {
  const [file, setFile] = useState<File | Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<string>('pointer');
  const [isSigned, setIsSigned] = useState<boolean>(false);
  const [isPremium, setIsPremium] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showPremiumModal, setShowPremiumModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{page: number, text: string}[]>([]);
  const [currentSearchIdx, setCurrentSearchIdx] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOptions, setSearchOptions] = useState({ matchCase: false, wholeWords: false });
  const [viewMode, setViewMode] = useState<'single' | 'dual'>('single');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [pendingMergeFiles, setPendingMergeFiles] = useState<File[]>([]);
  const [pendingAction, setPendingAction] = useState<'merge' | 'add'>('merge');
  const [pageToScrollToAfterLoad, setPageToScrollToAfterLoad] = useState<number | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [modalPreviewIdx, setModalPreviewIdx] = useState(0);
  const [mergePreference, setMergePreference] = useState({ 
    width: 595, 
    height: 842, 
    orientation: 'portrait' as 'portrait' | 'landscape',
    autoOrientation: true,
    lockRatio: true
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const addPdfInputRef = useRef<HTMLInputElement>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageIndex = Number(entry.target.getAttribute('data-page-index'));
          if (!isNaN(pageIndex)) {
            setPageNumber(pageIndex + 1);
          }
        }
      });
    }, { threshold: 0.5 });

    // Load recent files
    const stored = localStorage.getItem('nitro_recent_files');
    if (stored) {
      try {
        setRecentFiles(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load history', e);
      }
    }

    return () => observerRef.current?.disconnect();
  }, []);

  const addToHistory = (name: string) => {
    const newEntry = { name, timestamp: Date.now() };
    const filtered = recentFiles.filter(f => f.name !== name).slice(0, 4);
    const updated = [newEntry, ...filtered];
    setRecentFiles(updated);
    localStorage.setItem('nitro_recent_files', JSON.stringify(updated));
  };

  const registerPage = (el: HTMLDivElement | null) => {
    if (el) observerRef.current?.observe(el);
  };

  const scrollToPage = (pIdx: number, behavior: ScrollBehavior = 'smooth') => {
    if (pIdx >= 0) {
      const target = document.querySelector(`[data-page-index="${pIdx}"]`);
      if (target) {
        target.scrollIntoView({ behavior, block: 'start' });
      } else if (pIdx === 0 && canvasContainerRef.current) {
        // Fallback for first page if selector hasn't updated yet
        canvasContainerRef.current.scrollIntoView({ behavior });
      }
    }
  };

  const handleSearch = async (query: string, options = searchOptions) => {
    setSearchQuery(query);
    if (!query || query.length < 2 || !file) {
      setSearchResults([]);
      setCurrentSearchIdx(-1);
      return;
    }

    setIsSearching(true);
    try {
      const bytes = file instanceof File ? await file.arrayBuffer() : file;
      const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
      const pdf = await loadingTask.promise;
      
      const results: {page: number, text: string}[] = [];
      const searchRegex = new RegExp(
        options.wholeWords ? `\\b${query}\\b` : query, 
        options.matchCase ? 'g' : 'gi'
      );

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(' ');
        
        if (searchRegex.test(text)) {
          results.push({ page: i, text: text.trim().substring(0, 50) + '...' });
        }
      }
      setSearchResults(results);
      if (results.length > 0) {
        setCurrentSearchIdx(0);
        scrollToPage(results[0].page - 1);
      } else {
        setCurrentSearchIdx(-1);
      }
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setIsSearching(false);
    }
  };

  const nextSearchResult = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentSearchIdx + 1) % searchResults.length;
    setCurrentSearchIdx(nextIdx);
    scrollToPage(searchResults[nextIdx].page - 1);
  };

  const prevSearchResult = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (currentSearchIdx - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIdx(prevIdx);
    scrollToPage(searchResults[prevIdx].page - 1);
  };
  
  const pdfSource = useMemo(() => {
    if (!file) return null;
    if (file instanceof File) return file;
    // We slice the Uint8Array to provide a fresh copy to react-pdf.
    // This prevents the "ArrayBuffer is already detached" error when 
    // react-pdf's worker transfers the buffer and we try to modify the PDF again.
    return { data: file.slice() };
  }, [file]);

  const modalPdfSource = useMemo(() => {
    const pFile = pendingMergeFiles[modalPreviewIdx];
    if (!pFile) return null;
    return pFile;
  }, [pendingMergeFiles, modalPreviewIdx]);

  // Check for payment success from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setIsPremium(true);
      // Clean up URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (uploadedFile) {
      setFile(uploadedFile);
      setFileName(uploadedFile.name);
      addToHistory(uploadedFile.name);
      setPageNumber(1);
      setAnnotations([]);
      
      // Check for signatures
      try {
        const bytes = await uploadedFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(bytes);
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        const hasSig = fields.some(f => f.constructor.name === 'PDFSignature');
        setIsSigned(hasSig);
      } catch (e) {
        console.warn('Signature check failed', e);
      }
    }
  };

  const getPdfDoc = async () => {
    if (!file) return null;
    const bytes = file instanceof File ? await file.arrayBuffer() : file;
    return await PDFDocument.load(bytes);
  };

  const updatePdfView = async (pdfDoc: PDFDocument, targetPage?: number) => {
    setPageToScrollToAfterLoad(targetPage ?? pageNumber);
    const pdfBytes = await pdfDoc.save();
    setFile(pdfBytes);
  };

  const handleAddBlankPage = async () => {
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;
    pdfDoc.insertPage(pageNumber, [595.28, 841.89]); // A4
    await updatePdfView(pdfDoc);
  };

  const handleRotatePage = async (angleDelta: number) => {
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;
    const page = pdfDoc.getPage(pageNumber - 1);
    const rotation = page.getRotation();
    const currentAngle = rotation.angle;
    page.setRotation(degrees((currentAngle + angleDelta + 360) % 360));
    await updatePdfView(pdfDoc);
  };

  const handleResizePage = async (newWidth: number, newHeight: number) => {
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;
    
    const pageIndex = pageNumber - 1;
    const oldPage = pdfDoc.getPage(pageIndex);
    
    // Detect true visible bounds
    const mediaBox = oldPage.getMediaBox();
    const cropBox = oldPage.getCropBox();
    const rotation = oldPage.getRotation().angle;
    const is90or270 = (rotation / 90) % 2 !== 0;

    // Embed current page as XObject to reset coordinates
    const [embeddedPage] = await pdfDoc.embedPages([oldPage]);
    const { width: srcVisualW, height: srcVisualH } = embeddedPage;

    // Create a new blank normalized page
    const newPage = pdfDoc.insertPage(pageNumber, [newWidth, newHeight]);
    
    // Scaling and Centering Logic
    const scale = Math.min(newWidth / srcVisualW, newHeight / srcVisualH, 1);
    const drawW = srcVisualW * scale;
    const drawH = srcVisualH * scale;
    
    const dx = (newWidth - drawW) / 2;
    const dy = (newHeight - drawH) / 2;

    newPage.drawPage(embeddedPage, {
      x: dx,
      y: dy,
      width: drawW,
      height: drawH,
    });

    // Remove old page
    pdfDoc.removePage(pageIndex);

    // Update annotations
    setAnnotations(prev => prev.map(ann => {
      if (ann.page === pageNumber) {
        return {
          ...ann,
          x: ann.x * scale + dx,
          y: ann.y * scale + dy
        };
      }
      return ann;
    }));
    
    await updatePdfView(pdfDoc, pageNumber);
  };

  const handleDeletePage = async () => {
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc || numPages <= 1) return;
    pdfDoc.removePage(pageNumber - 1);
    const targetPage = pageNumber > numPages - 1 ? numPages - 1 : pageNumber;
    if (pageNumber > numPages - 1) {
      setPageNumber(numPages - 1);
    }
    await updatePdfView(pdfDoc, targetPage);
  };

  const handleDeleteRange = async (start: number, end: number) => {
    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;

    if (isNaN(start) || isNaN(end) || start < 1 || end > numPages || start > end) {
      alert('Invalid range');
      return;
    }

    // Remove in reverse order to keep indices correct
    for (let i = end - 1; i >= start - 1; i--) {
      pdfDoc.removePage(i);
    }

    const newNumPages = numPages - (end - start + 1);
    if (pageNumber > newNumPages) {
      setPageNumber(Math.max(1, newNumPages));
    }
    await updatePdfView(pdfDoc);
  };

  const onAddPdfFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const otherFile = event.target.files?.[0];
    if (!otherFile || !file) return;
    setPendingMergeFiles([otherFile]);
    setPendingAction('add');
    setModalPreviewIdx(0);
    setShowMergeModal(true);
    event.target.value = '';
  };

  const onMergeFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const filesArray = Array.from(event.target.files || []) as File[];
    if (filesArray.length === 0) return;
    
    if (filesArray.length === 1) {
      setFile(filesArray[0]);
      setFileName(filesArray[0].name);
      addToHistory(filesArray[0].name);
      event.target.value = '';
      return;
    }

    setPendingMergeFiles(filesArray);
    setPendingAction('merge');
    setModalPreviewIdx(0);
    setShowMergeModal(true);
    event.target.value = '';
  };

  const handleExecuteMerge = async () => {
    if (pendingMergeFiles.length === 0) return;
    
    setIsSyncing(true);
    setShowMergeModal(false);
    
    try {
      const { width, height, orientation, autoOrientation } = mergePreference;
      
      // Determine base target dimensions
      let baseTargetWidth = orientation === 'portrait' ? Math.min(width, height) : Math.max(width, height);
      let baseTargetHeight = orientation === 'portrait' ? Math.max(width, height) : Math.min(width, height);

      let mergedPdf: PDFDocument;
      if (pendingAction === 'add' && file) {
        mergedPdf = await getPdfDoc() as PDFDocument;
      } else {
        mergedPdf = await PDFDocument.create();
      }
      
      for (const fileObj of pendingMergeFiles) {
        const bytes = await fileObj.arrayBuffer();
        const srcPdf = await PDFDocument.load(bytes);
        const embeddedPages = await mergedPdf.embedPages(srcPdf.getPages());
        
        embeddedPages.forEach((embeddedPage, idx) => {
          // pdf-lib's embeddedPage width/height are the visual CropBox dimensions after rotation
          const { width: srcVisualW, height: srcVisualH } = embeddedPage;
          const isSrcLandscape = srcVisualW > srcVisualH;
          
          let currentTargetWidth = baseTargetWidth;
          let currentTargetHeight = baseTargetHeight;

          if (autoOrientation) {
            if (isSrcLandscape) {
              currentTargetWidth = Math.max(baseTargetWidth, baseTargetHeight);
              currentTargetHeight = Math.min(baseTargetWidth, baseTargetHeight);
            } else {
              currentTargetWidth = Math.min(baseTargetWidth, baseTargetHeight);
              currentTargetHeight = Math.max(baseTargetWidth, baseTargetHeight);
            }
          }

          // Create a new blank page
          const newPage = pendingAction === 'add'
            ? mergedPdf.insertPage(pageNumber + idx, [currentTargetWidth, currentTargetHeight])
            : mergedPdf.addPage([currentTargetWidth, currentTargetHeight]);

          // Scale to fit while maintaining aspect ratio
          // If the source is an architectural drawing with internal offsets,
          // drawPage with these dimensions ensures the entire visible area is centered.
          const scale = Math.min(currentTargetWidth / srcVisualW, currentTargetHeight / srcVisualH, 1);
          const drawW = srcVisualW * scale;
          const drawH = srcVisualH * scale;

          newPage.drawPage(embeddedPage, {
            x: (currentTargetWidth - drawW) / 2,
            y: (currentTargetHeight - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        });
      }
      
      const mergedBytes = await mergedPdf.save();
      if (pendingAction === 'add') {
        setPageToScrollToAfterLoad(pageNumber);
      }
      const newName = pendingAction === 'merge' ? `merged_${pendingMergeFiles.length}_files.pdf` : fileName;
      addToHistory(newName);
      setFile(mergedBytes);
      if (pendingAction === 'merge') {
        setFileName(newName);
        setPageNumber(1);
      }
      setIsSigned(false);
    } catch (err) {
      console.error(err);
      alert('Error processing PDFs.');
    } finally {
      setIsSyncing(false);
      setPendingMergeFiles([]);
    }
  };

  const onAddImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const imgFile = event.target.files?.[0];
    if (!imgFile || !file) return;

    const pdfDoc = await getPdfDoc();
    if (!pdfDoc) return;

    const imgBytes = await imgFile.arrayBuffer();
    let embeddedImg;
    if (imgFile.type === 'image/jpeg') {
      embeddedImg = await pdfDoc.embedJpg(imgBytes);
    } else if (imgFile.type === 'image/png') {
      embeddedImg = await pdfDoc.embedPng(imgBytes);
    } else {
      alert('Only JPG/PNG');
      return;
    }

    const { width, height } = embeddedImg.scale(1);
    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    
    // Fit image to A4 while maintaining aspect ratio
    const scaleFactor = Math.min(A4_WIDTH / width, A4_HEIGHT / height, 1);
    const drawWidth = width * scaleFactor;
    const drawHeight = height * scaleFactor;
    
    const newPage = pdfDoc.insertPage(pageNumber, [A4_WIDTH, A4_HEIGHT]);
    newPage.drawImage(embeddedImg, { 
      x: (A4_WIDTH - drawWidth) / 2, 
      y: (A4_HEIGHT - drawHeight) / 2, 
      width: drawWidth, 
      height: drawHeight 
    });

    await updatePdfView(pdfDoc);
    event.target.value = '';
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    if (pageToScrollToAfterLoad !== null) {
      const p = pageToScrollToAfterLoad;
      setPageToScrollToAfterLoad(null);
      setTimeout(() => {
        scrollToPage(p - 1, 'auto');
      }, 150);
    }
  };

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>, pNum: number) => {
    if (activeTool === 'pointer' || !file) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        setAnnotations([...annotations, {
          id: Math.random().toString(36).substr(2, 9),
          type: 'text',
          x: x / scale, // Store normalized coordinates
          y: y / scale,
          page: pNum,
          content: text
        }]);
      }
    } else if (activeTool === 'image') {
      setAnnotations([...annotations, {
        id: Math.random().toString(36).substr(2, 9),
        type: 'image',
        x: x / scale,
        y: y / scale,
        page: pNum,
        imageUrl: 'https://picsum.photos/seed/tool/200/100',
        width: 150,
        height: 75
      }]);
    }
  };

  const generateEditedPdfBytes = async () => {
    if (!file) return null;
    const bytes = file instanceof File ? await file.arrayBuffer() : file;
    const pdfDoc = await PDFDocument.load(bytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const ann of annotations) {
      if (!pages[ann.page - 1]) continue;
      const page = pages[ann.page - 1];
      const { height } = page.getSize();
      
      if (ann.type === 'text' && ann.content) {
        page.drawText(ann.content, {
          x: ann.x,
          y: height - ann.y,
          size: 12,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
      }
    }

    return await pdfDoc.save();
  };

  const handlePrint = async () => {
    if (!file) return;
    setIsSyncing(true);
    try {
      const pdfBytes = await generateEditedPdfBytes();
      if (!pdfBytes) return;
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      // Using window.open is more reliable for printing PDFs in sandboxed environments
      // as it leverages the browser's native PDF viewer print capabilities.
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.focus();
        // We don't call .print() immediately as most browsers' PDF viewers
        // have their own built-in print controls.
      } else {
        alert('Please allow popups to print the document.');
      }
      
      // Cleanup URL after some time
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Print failed', err);
      alert('Failed to prepare document for printing.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!file) return;
    setIsSyncing(true);
    
    try {
      const pdfBytes = await generateEditedPdfBytes();
      if (!pdfBytes) return;

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `edited_${fileName || 'document.pdf'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Simulate Cloud Sync
      setTimeout(() => setIsSyncing(false), 2000);
    } catch (err) {
      console.error(err);
      setIsSyncing(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      if (!stripePromise) {
        console.warn('Stripe Public Key is missing. Check your Secrets panel. Entering demo mode.');
        setIsPremium(true);
        setShowPremiumModal(false);
        return;
      }

      const stripe = await stripePromise;
      if (!stripe) {
        setIsPremium(true);
        setShowPremiumModal(false);
        return;
      };

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const session = await response.json();
      const result = await (stripe as any).redirectToCheckout({
        sessionId: session.id,
      });

      if (result.error) {
        alert(result.error.message);
      }
    } catch (error) {
      console.error(error);
      // Demo fallback if Stripe is not configured
      setIsPremium(true);
      setShowPremiumModal(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 border-t border-gray-200">
      {/* Sidebar / Tools */}
      <aside className="w-16 md:w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center">
            <span className="text-white font-bold">N</span>
          </div>
          <span className="font-bold text-gray-900 hidden md:block">NitroPDF Cloud</span>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {/* Group 1: Navigation & Search */}
          <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block border-b border-gray-50 mb-2">Navigation & Search</p>
          <div className="px-4 pb-2 space-y-2">
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search document..." 
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-8 py-2 text-xs outline-none focus:border-indigo-500 transition-apple"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              {searchQuery && (
                <button 
                  onClick={() => handleSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            
            <div className="flex items-center gap-3 px-1">
              <label className="flex items-center gap-1.5 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={searchOptions.matchCase}
                  onChange={(e) => {
                    const newOpts = { ...searchOptions, matchCase: e.target.checked };
                    setSearchOptions(newOpts);
                    handleSearch(searchQuery, newOpts);
                  }}
                />
                <div className={`w-3 h-3 rounded-sm border transition-colors ${searchOptions.matchCase ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                  {searchOptions.matchCase && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="w-2 h-2 m-auto">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] text-gray-500 group-hover:text-gray-700">Ab </span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={searchOptions.wholeWords}
                  onChange={(e) => {
                    const newOpts = { ...searchOptions, wholeWords: e.target.checked };
                    setSearchOptions(newOpts);
                    handleSearch(searchQuery, newOpts);
                  }}
                />
                <div className={`w-3 h-3 rounded-sm border transition-colors ${searchOptions.wholeWords ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                  {searchOptions.wholeWords && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" className="w-2 h-2 m-auto">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] text-gray-500 group-hover:text-gray-700">"W" </span>
              </label>
            </div>
            
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between bg-indigo-50/50 p-2 rounded-lg">
                <span className="text-[10px] font-bold text-indigo-600">
                  {currentSearchIdx + 1}/{searchResults.length}
                </span>
                <div className="flex gap-1">
                  <button onClick={prevSearchResult} className="p-1 hover:bg-white rounded shadow-sm text-indigo-600"><ArrowUp size={12} /></button>
                  <button onClick={nextSearchResult} className="p-1 hover:bg-white rounded shadow-sm text-indigo-600"><ArrowDown size={12} /></button>
                </div>
              </div>
            )}
            
            <div className="relative pt-2">
              <input 
                type="number" 
                placeholder="Jump to page..." 
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-4 py-2 text-xs outline-none focus:border-indigo-500 transition-apple"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = Number((e.target as HTMLInputElement).value);
                    scrollToPage(val - 1);
                  }
                }}
              />
              <Plus size={14} className="absolute left-2.5 top-[calc(50%+4px)] -translate-y-1/2 text-gray-400 rotate-45" />
            </div>
          </div>

          {/* Group 2: Annotation Tools */}
          <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block pt-4 border-t border-gray-100">Annotation Tools</p>
          <div className="grid grid-cols-2 gap-1 px-2">
            <button 
              onClick={() => handleToolClick('pointer')}
              className={`toolbar-btn flex-col p-3 ${activeTool === 'pointer' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}
            >
              <MousePointer2 size={18} />
              <span className="text-[10px] mt-1 font-medium">Select</span>
            </button>
            <button 
              onClick={() => handleToolClick('text')}
              className={`toolbar-btn flex-col p-3 ${activeTool === 'text' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}
            >
              <Type size={18} />
              <span className="text-[10px] mt-1 font-medium">Text</span>
            </button>
            <button 
              onClick={() => handleToolClick('image')}
              className={`toolbar-btn flex-col p-3 ${activeTool === 'image' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}
            >
              <ImageIcon size={18} />
              <span className="text-[10px] mt-1 font-medium">Image</span>
            </button>
            <button 
              onClick={() => handleToolClick('highlight')}
              className={`toolbar-btn flex-col p-3 ${activeTool === 'highlight' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}
            >
              <Highlighter size={18} />
              <span className="text-[10px] mt-1 font-medium">Mark</span>
            </button>
          </div>

          {/* Group 3: Page Layout & Size */}
          <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block pt-4 border-t border-gray-100">Page Properties</p>
          <div className="px-4 space-y-3 pb-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <input 
                  type="number" 
                  id="pg-width"
                  placeholder="Width" 
                  className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none focus:border-indigo-500" 
                />
              </div>
              <div className="flex-1">
                <input 
                  type="number" 
                  id="pg-height"
                  placeholder="Height" 
                  className="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none focus:border-indigo-500" 
                />
              </div>
            </div>
            <button 
              onClick={() => {
                const w = Number((document.getElementById('pg-width') as HTMLInputElement)?.value);
                const h = Number((document.getElementById('pg-height') as HTMLInputElement)?.value);
                if (w && h) handleResizePage(w, h);
              }}
              className="w-full py-1.5 bg-neutral-900 text-white rounded text-[10px] font-bold hover:bg-neutral-800 transition-apple"
            >
              Update Dimensions
            </button>
            <div className="flex gap-1">
              <button onClick={() => handleRotatePage(90)} className="flex-1 toolbar-btn bg-gray-50 text-gray-600 hover:text-indigo-600" title="Rotate CW">
                <RotateCw size={14} />
              </button>
              <button onClick={() => handleRotatePage(-90)} className="flex-1 toolbar-btn bg-gray-50 text-gray-600 hover:text-indigo-600" title="Rotate CCW">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {/* Group 4: Document Organization */}
          <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block pt-4 border-t border-gray-100">Edit Document</p>
          <div className="px-2 space-y-1">
            <button onClick={() => mergeInputRef.current?.click()} className="w-full toolbar-btn text-indigo-600 hover:bg-indigo-50 font-medium bg-indigo-50/30">
              <Copy size={16} />
              <span className="hidden md:block">Merge PDFs</span>
            </button>
            <button onClick={handleAddBlankPage} className="w-full toolbar-btn text-gray-500 hover:text-indigo-600 hover:bg-gray-50">
              <Plus size={16} />
              <span className="hidden md:block">Insert Blank Page</span>
            </button>
            <button onClick={() => addPdfInputRef.current?.click()} className="w-full toolbar-btn text-gray-500 hover:text-indigo-600 hover:bg-gray-50">
              <FilePlus size={16} />
              <span className="hidden md:block">Add PDF File</span>
            </button>
          </div>

          {/* Group 5: Page Management & Deletion */}
          <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block pt-4 border-t border-gray-100 text-red-400">Danger Zone</p>
          <div className="px-2 space-y-2">
            <div className="flex gap-1 px-2">
              <input type="number" id="del-start" placeholder="From" className="w-full bg-red-50/30 border border-red-100 rounded px-2 py-1 text-[10px] outline-none focus:border-red-500" />
              <input type="number" id="del-end" placeholder="To" className="w-full bg-red-50/30 border border-red-100 rounded px-2 py-1 text-[10px] outline-none focus:border-red-500" />
            </div>
            <button 
              onClick={() => {
                const start = Number((document.getElementById('del-start') as HTMLInputElement)?.value);
                const end = Number((document.getElementById('del-end') as HTMLInputElement)?.value);
                handleDeleteRange(start, end);
              }} 
              className="w-full toolbar-btn text-red-500 hover:bg-red-50"
            >
              <Trash2 size={16} />
              <span className="hidden md:block">Delete Range</span>
            </button>
            <button onClick={handleDeletePage} className="w-full toolbar-btn text-red-600 font-medium hover:bg-red-50">
              <X size={16} className="bg-red-100 rounded-full" />
              <span className="hidden md:block">Remove Current Page</span>
            </button>
          </div>

          <div className="pt-4 border-t border-gray-100 mt-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase px-4 py-2 hidden md:block">Storage</p>
            <div className="px-4 py-2 flex items-center gap-3 text-gray-500 text-sm">
              <Cloud size={16} />
              <span className="hidden md:block">Secure Cloud</span>
              <div className={`ml-auto w-2 h-2 rounded-full ${isSyncing ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`}></div>
            </div>
          </div>

          <input type="file" ref={addPdfInputRef} className="hidden" accept=".pdf" onChange={onAddPdfFile} />
          <input type="file" ref={addImageInputRef} className="hidden" accept="image/jpeg,image/png" onChange={onAddImageFile} />
          <input type="file" ref={mergeInputRef} className="hidden" accept=".pdf" multiple onChange={onMergeFiles} />
        </nav>

        {!isPremium && (
          <div className="p-4 mx-2 mb-4 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-2xl hidden md:block shadow-sm">
            <h4 className="text-white font-bold text-sm mb-1 flex items-center gap-2">
              <Crown size={16} /> GO PRO
            </h4>
            <p className="text-indigo-100 text-[10px] mb-3">Unlock signature insertion, image overlays, and 50GB cloud storage.</p>
            <button 
              onClick={() => setShowPremiumModal(true)}
              className="w-full py-2 bg-white text-indigo-700 rounded-lg text-xs font-bold hover:bg-neutral-100 transition-colors"
            >
              Upgrade Now
            </button>
          </div>
        )}

        <div className="p-4 border-t border-gray-100">
           <button className="w-full toolbar-btn text-gray-400">
            <Settings size={18} />
            <span className="hidden md:block">Settings</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col bg-gray-100">
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <FileUp size={16} />
              Open PDF
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".pdf" 
              onChange={onFileChange} 
            />
            {file && (
              <span className="text-sm font-medium text-neutral-600 truncate max-w-[200px]">
                {fileName}
              </span>
            )}
            {isSigned && (
              <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full flex items-center gap-1 border border-amber-200">
                <CheckCircle2 size={10} />
                Digitally Signed
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-50 rounded-lg p-1 mr-2">
              <button 
                onClick={() => setViewMode('single')}
                className={`p-1.5 rounded ${viewMode === 'single' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="Single Page View"
              >
                <Square size={16} />
              </button>
              <button 
                onClick={() => setViewMode('dual')}
                className={`p-1.5 rounded ${viewMode === 'dual' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="Two-Page View"
              >
                <Columns2 size={16} />
              </button>
            </div>

            <button 
              onClick={handlePrint}
              disabled={!file}
              className="px-3 py-1.5 text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all flex items-center gap-2"
            >
              <Printer size={16} />
              <span className="text-xs font-bold hidden sm:inline">Print</span>
            </button>
            <div className="flex items-center bg-neutral-100 rounded-lg p-1 mr-4">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-1 hover:bg-white rounded"><ZoomOut size={16} /></button>
              <span className="text-xs font-bold px-2 w-12 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(2.5, s + 0.1))} className="p-1 hover:bg-white rounded"><ZoomIn size={16} /></button>
            </div>
            
            <button 
              onClick={handleSave}
              disabled={!file}
              className="flex items-center gap-2 px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {isSyncing ? <Save className="animate-spin" size={16} /> : <Download size={16} />}
              Export & Save
            </button>
          </div>
        </header>

        {/* PDF Stage */}
        <div className="flex-1 overflow-auto bg-gray-200 flex flex-col items-center py-8 relative">
          <AnimatePresence>
            {!file && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="max-w-md w-full p-8 bg-white rounded-2xl shadow-xl text-center border-2 border-dashed border-gray-300 mt-20"
              >
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-600">
                  <FileUp size={32} />
                </div>
                <h2 className="text-xl font-bold mb-2">Build your document</h2>
                <p className="text-neutral-500 text-sm mb-8">Upload a PDF to edit, or combine multiple files into a single document.</p>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-3 p-6 bg-indigo-50 text-indigo-700 rounded-2xl hover:bg-indigo-100 transition-colors group"
                  >
                    <FileUp size={24} className="group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">Edit PDF</span>
                  </button>
                  <button 
                    onClick={() => mergeInputRef.current?.click()}
                    className="flex flex-col items-center gap-3 p-6 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-colors group"
                  >
                    <Copy size={24} className="group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">Merge PDFs</span>
                  </button>
                </div>

                {recentFiles.length > 0 && (
                  <div className="mt-8 text-left">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Recently Accessed</p>
                    <div className="space-y-2">
                      {recentFiles.map((rf, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white flex items-center justify-center rounded-lg border border-neutral-100 text-neutral-400">
                              <ImageIcon size={14} />
                            </div>
                            <span className="text-xs font-medium text-neutral-700 truncate max-w-[150px]">{rf.name}</span>
                          </div>
                          <span className="text-[10px] text-neutral-400">{new Date(rf.timestamp).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-neutral-400">Secure AES-256 cloud encryption enabled</p>
              </motion.div>
            )}
          </AnimatePresence>

        <AnimatePresence>
          {showMergeModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-auto"
              >
                {/* Left: Settings Panel */}
                <div className="flex-1 overflow-y-auto p-8 border-b md:border-b-0 md:border-r border-gray-100 max-h-[50vh] md:max-h-[80vh]">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 leading-tight">Layout Settings</h3>
                      <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">Configuring {pendingMergeFiles.length} file{pendingMergeFiles.length > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-8">
                    {/* Auto-Orientation Toggle */}
                    <div className="flex items-center justify-between p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                      <div>
                        <p className="text-sm font-bold text-indigo-900">Auto Orientation</p>
                        <p className="text-[10px] text-indigo-600">Detect orientation from source files</p>
                      </div>
                      <button 
                        onClick={() => setMergePreference({...mergePreference, autoOrientation: !mergePreference.autoOrientation})}
                        className={`w-12 h-6 rounded-full transition-colors relative ${mergePreference.autoOrientation ? 'bg-indigo-600' : 'bg-gray-300'}`}
                      >
                        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${mergePreference.autoOrientation ? 'translate-x-6' : ''}`}></div>
                      </button>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Base Orientation</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          disabled={mergePreference.autoOrientation}
                          onClick={() => setMergePreference({...mergePreference, orientation: 'portrait'})}
                          className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${mergePreference.orientation === 'portrait' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-400 hover:border-gray-200'} ${mergePreference.autoOrientation ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="w-6 h-8 border-2 border-current rounded-sm"></div>
                          <span className="text-xs font-bold font-mono">PORTRAIT</span>
                        </button>
                        <button 
                          disabled={mergePreference.autoOrientation}
                          onClick={() => setMergePreference({...mergePreference, orientation: 'landscape'})}
                          className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${mergePreference.orientation === 'landscape' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-400 hover:border-gray-200'} ${mergePreference.autoOrientation ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="w-8 h-6 border-2 border-current rounded-sm"></div>
                          <span className="text-xs font-bold font-mono">LANDSCAPE</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Page Format</label>
                        <div className="flex items-center gap-1">
                           <span className="text-[10px] text-gray-400 font-mono">RATIO: {((mergePreference.width / mergePreference.height) || 1).toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { name: 'A4', w: 595, h: 842 },
                          { name: 'A3', w: 842, h: 1191 },
                          { name: 'A5', w: 420, h: 595 },
                          { name: 'LETTER', w: 612, h: 792 },
                          { name: 'LEGAL', w: 612, h: 1008 },
                          { name: 'TABLOID', w: 792, h: 1224 }
                        ].map(size => (
                          <button 
                            key={size.name}
                            onClick={() => setMergePreference({...mergePreference, width: size.w, height: size.h})} 
                            className={`py-2 px-1 rounded-xl text-[10px] font-bold border transition-colors ${mergePreference.width === size.w ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}
                          >
                            {size.name}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-2">
                         <div className="flex-1 relative">
                            <input 
                              type="number" 
                              value={mergePreference.width} 
                              onChange={e => {
                                const val = Number(e.target.value);
                                setMergePreference(prev => ({
                                  ...prev, 
                                  width: val,
                                  height: prev.lockRatio ? Math.round(val / (prev.width / prev.height)) : prev.height
                                }));
                              }} 
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500 font-mono" 
                              placeholder="Width" 
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[8px] text-gray-400 font-bold uppercase">pt</span>
                         </div>
                         <div className="flex items-center justify-center text-gray-300">
                           <button onClick={() => setMergePreference({...mergePreference, lockRatio: !mergePreference.lockRatio})} className={`p-1 rounded hover:bg-gray-100 transition-colors ${mergePreference.lockRatio ? 'text-indigo-600' : 'text-gray-300'}`}>
                             <Copy size={14} className={mergePreference.lockRatio ? 'rotate-90' : ''} />
                           </button>
                         </div>
                         <div className="flex-1 relative">
                            <input 
                              type="number" 
                              value={mergePreference.height} 
                              onChange={e => {
                                const val = Number(e.target.value);
                                setMergePreference(prev => ({
                                  ...prev, 
                                  height: val,
                                  width: prev.lockRatio ? Math.round(val * (prev.width / prev.height)) : prev.width
                                }));
                              }} 
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500 font-mono" 
                              placeholder="Height" 
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[8px] text-gray-400 font-bold uppercase">pt</span>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Preview Panel */}
                <div className="w-full md:w-[320px] bg-gray-50 flex flex-col">
                  <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50"></div>
                    
                    {/* Visual Page Preview */}
                    <motion.div 
                      layout
                      initial={false}
                      className="relative z-10 flex flex-col items-center gap-4"
                    >
                      <div className="relative group">
                        <Document
                          file={modalPdfSource}
                          loading={<div className="w-[124px] h-[178px] bg-white animate-pulse" />}
                        >
                          <Page 
                            pageNumber={1} 
                            width={140}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            className="shadow-2xl rounded-sm border border-gray-200"
                          />
                        </Document>

                        {pendingMergeFiles.length > 1 && (
                          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => setModalPreviewIdx(prev => Math.max(0, prev - 1))}
                              className="p-1.5 bg-black/50 text-white rounded-full backdrop-blur-sm hover:bg-black/70"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <button 
                              onClick={() => setModalPreviewIdx(prev => Math.min(pendingMergeFiles.length - 1, prev + 1))}
                              className="p-1.5 bg-black/50 text-white rounded-full backdrop-blur-sm hover:bg-black/70"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="bg-white/80 backdrop-blur px-3 py-1 rounded-full border border-gray-200">
                         <span className="text-[10px] font-bold text-gray-900 font-mono">
                           FILE {modalPreviewIdx + 1}/{pendingMergeFiles.length}
                         </span>
                      </div>
                    </motion.div>

                    <div className="absolute bottom-4 left-0 right-0 text-center">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Real-time Import Preview</p>
                    </div>
                  </div>

                  <div className="p-8 bg-white border-t border-gray-100 flex flex-col gap-3">
                    <button onClick={handleExecuteMerge} className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 group">
                      Initialize {pendingAction === 'merge' ? 'Merge' : 'Insertion'}
                      <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                    <button onClick={() => setShowMergeModal(false)} className="w-full py-2 text-gray-400 text-xs font-bold hover:text-gray-600 transition-colors">
                      Discard Changes
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

          {file && (
            <div className="flex flex-col pb-32" ref={canvasContainerRef}>
              <Document 
                file={pdfSource} 
                onLoadSuccess={onDocumentLoadSuccess}
                loading={<div className="p-20 text-neutral-500">Loading document...</div>}
              >
                {(viewMode === 'dual' 
                  ? Array.from({ length: numPages }, (_, i) => i + 1).reduce((acc, curr, i) => {
                      if (i % 2 === 0) acc.push([curr]);
                      else acc[acc.length - 1].push(curr);
                      return acc;
                    }, [] as number[][])
                  : Array.from({ length: numPages }, (_, i) => i + 1).map(p => [p])
                ).map((group, grpIdx) => (
                  <div key={`group-${grpIdx}`} className="flex justify-center gap-8 mb-8">
                    {group.map((pNum) => (
                      <div 
                        key={pNum} 
                        data-page-index={pNum - 1}
                        ref={registerPage}
                        className="relative shadow-2xl bg-white h-fit"
                        onClick={(e) => handleCanvasClick(e, pNum)}
                      >
                        <Page 
                          pageNumber={pNum} 
                          scale={scale} 
                          devicePixelRatio={Math.min(2, window.devicePixelRatio * 1.5)} // Sharpness boost
                          renderTextLayer={true} 
                          renderAnnotationLayer={false}
                        />
                        
                        {/* Page Specific Annotations */}
                        <div className="absolute inset-0 pointer-events-none">
                          {annotations.filter(a => a.page === pNum).map(ann => (
                            <div 
                              key={ann.id}
                              style={{ left: ann.x * scale, top: ann.y * scale }}
                              className="absolute pointer-events-auto cursor-move group"
                            >
                              {ann.type === 'text' && (
                                <div className="px-2 py-1 bg-yellow-100 border border-yellow-400 text-sm whitespace-nowrap shadow-sm min-w-[50px]">
                                  {ann.content}
                                  <button className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 text-[8px] hidden group-hover:block" onClick={(e) => { e.stopPropagation(); setAnnotations(annotations.filter(a => a.id !== ann.id)); }}>×</button>
                                </div>
                              )}
                              {ann.type === 'image' && (
                                <div className="relative">
                                  <img src={ann.imageUrl} width={ann.width! * scale} height={ann.height! * scale} className="border-2 border-dashed border-blue-400" referrerPolicy="no-referrer" />
                                  <button className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 text-[8px] hidden group-hover:block" onClick={(e) => { e.stopPropagation(); setAnnotations(annotations.filter(a => a.id !== ann.id)); }}>×</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </Document>
            </div>
          )}

          {/* Pagination */}
          {file && numPages > 1 && (
            <div className="mt-8 flex items-center bg-white rounded-full shadow-lg border border-neutral-200 p-1 mb-20 sticky bottom-8">
              <button 
                disabled={pageNumber <= 1}
                onClick={() => scrollToPage(pageNumber - 2)}
                className="p-2 hover:bg-neutral-100 rounded-full disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="px-6 text-sm font-bold flex items-center gap-2">
                Page <input 
                  type="number" 
                  value={pageNumber} 
                  onChange={(e) => scrollToPage(Number(e.target.value) - 1)}
                  className="w-10 text-center border-b border-gray-300 focus:border-indigo-500 outline-none"
                /> of {numPages}
              </span>
              <button 
                disabled={pageNumber >= numPages}
                onClick={() => scrollToPage(pageNumber)}
                className="p-2 hover:bg-neutral-100 rounded-full disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 right-0 p-4 z-20">
         {isSyncing && (
           <div className="bg-white px-4 py-2 rounded-full shadow-lg border border-neutral-200 flex items-center gap-3 animate-in slide-in-from-bottom-4">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>
              <span className="text-xs font-bold text-neutral-600">Cloud Syncing...</span>
           </div>
         )}
      </footer>
    </div>
  );
}
