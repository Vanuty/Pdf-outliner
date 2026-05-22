import React, { useState } from "react";
import { ChevronRight, Edit3, Trash2, ArrowUp, ArrowDown, ChevronLeft, Plus, Check, X } from "lucide-react";
import { Bookmark } from "../types";

interface BookmarkTreeProps {
  bookmarks: Bookmark[];
  activePage: number;
  offset: number; // current page offset
  onUpdateBookmark: (id: string, updated: Partial<Bookmark>) => void;
  onDeleteBookmark: (id: string) => void;
  onGoToPage: (page: number) => void;
  onMoveBookmark: (index: number, direction: "up" | "down") => void;
  onAddBookmarkAt: (index: number) => void;
}

export default function BookmarkTree({
  bookmarks,
  activePage,
  offset,
  onUpdateBookmark,
  onDeleteBookmark,
  onGoToPage,
  onMoveBookmark,
  onAddBookmarkAt,
}: BookmarkTreeProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPage, setEditPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState("");

  const handleStartEdit = (b: Bookmark) => {
    setEditingId(b.id);
    setEditTitle(b.title);
    setEditPage(b.pageNumber);
  };

  const handleSaveEdit = (id: string) => {
    if (!editTitle.trim()) return;
    onUpdateBookmark(id, {
      title: editTitle,
      pageNumber: Math.max(1, editPage),
    });
    setEditingId(null);
  };

  const filteredBookmarks = bookmarks.map((b, idx) => ({ ...b, originalIndex: idx }))
    .filter(b => b.title.toLowerCase().includes(searchTerm.toLowerCase()));

  // Render a visual offset badge indicating target page with offset
  const getDisplayPage = (pageNum: number) => {
    const adjusted = pageNum + offset;
    return adjusted > 0 ? `${adjusted} (原:${pageNum})` : `${pageNum}`;
  };

  return (
    <div className="flex flex-col h-full bg-natural-bg border-l border-natural-border font-sans" id="bookmark-tree-container">
      {/* Container Header */}
      <div className="p-4 border-b border-natural-border bg-white flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-serif italic text-lg font-semibold text-natural-text">书签大纲 / Outlines</h3>
          <span className="text-[10px] bg-natural-bg border border-natural-border text-natural-accent font-mono font-bold px-2 py-0.5 rounded-md shadow-sm">
            共 {bookmarks.length} 项
          </span>
        </div>
        <input
          type="text"
          placeholder="搜索书签内容（实时配置）..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-xs px-3 py-1.5 bg-natural-bg border border-natural-border rounded-lg text-natural-text placeholder-natural-text/45 focus:border-natural-accent focus:ring-1 focus:ring-natural-accent focus:outline-none transition-colors"
        />
      </div>

      {/* Bookmarks List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4" id="bookmarks-scroll-container">
        <div className="w-full space-y-2.5 pb-2">
          {filteredBookmarks.length === 0 ? (
            <div className="text-center py-10 text-natural-text/45 text-xs font-serif italic">
              {searchTerm ? "未找到匹配的书签" : "暂无书签。请解析自带目录或启动 AI 提取。"}
            </div>
          ) : (
            filteredBookmarks.map((bookmark) => {
              const isEditing = editingId === bookmark.id;
              const absolutePage = bookmark.pageNumber + offset;
              const isPageActive = activePage === absolutePage;

              return (
                <div
                  key={bookmark.id}
                  className={`group relative flex items-start justify-between p-2.5 rounded-lg transition-all border ${
                    isPageActive
                      ? "bg-white shadow-sm border-l-4 border-natural-accent border-y border-r border-natural-border"
                      : "bg-white hover:bg-natural-aside/60 border-natural-border/70 text-natural-text"
                  }`}
                  style={{
                    marginLeft: `${(bookmark.level - 1) * 14}px`,
                    width: `calc(100% - ${(bookmark.level - 1) * 14}px)`
                  }}
                >
                  {/* Bookmarks hierarchical indentation connector */}
                  {bookmark.level > 1 && (
                    <div
                      className="absolute border-l border-dashed border-natural-accent/25"
                      style={{
                        left: `-${8}px`,
                        height: "38px",
                        top: "-19px",
                      }}
                    />
                  )}

                  {isEditing ? (
                    /* Editing Mode */
                    <div className="flex flex-col gap-2 w-full">
                      <div className="flex gap-1.5 items-center">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="flex-1 text-xs px-2 py-1 bg-natural-bg border border-natural-border rounded-lg text-natural-text focus:outline-none focus:ring-1 focus:ring-natural-accent"
                          placeholder="书签标题"
                          autoFocus
                        />
                        <input
                          type="number"
                          value={editPage}
                          onChange={(e) => setEditPage(parseInt(e.target.value) || 1)}
                          className="w-14 text-xs px-1.5 py-1 bg-natural-bg border border-natural-border rounded-lg text-natural-text focus:outline-none focus:ring-1 focus:ring-natural-accent"
                          placeholder="原始页"
                          min="1"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 text-natural-text/60 hover:text-natural-text rounded bg-natural-bg hover:bg-natural-aside/50"
                          title="取消"
                        >
                          <X size={13} />
                        </button>
                        <button
                          onClick={() => handleSaveEdit(bookmark.id)}
                          className="px-2.5 py-0.5 text-[11px] bg-natural-accent text-white rounded-lg hover:opacity-90 font-medium flex items-center gap-1 shadow-xs"
                          title="确认"
                        >
                          <Check size={12} /> 保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Interactive Mode */
                    <div className="flex items-start gap-2 flex-1 min-w-0 pr-[172px] md:pr-6 md:group-hover:pr-[172px] transition-all duration-200">
                      <span className="text-[9px] bg-natural-aside border border-natural-border/60 text-natural-accent px-1.5 py-0.5 rounded-md select-none shrink-0 font-bold font-mono mt-0.5">
                        L{bookmark.level}
                      </span>
                      <button
                        onClick={() => onGoToPage(absolutePage)}
                        className={`text-xs font-medium text-left break-all whitespace-normal py-0.5 cursor-pointer flex-1 min-w-0 transition-colors ${
                          isPageActive ? "text-natural-accent font-bold animate-pulse" : "text-natural-text/90 hover:text-natural-text"
                        }`}
                        title={`跳转至第 ${absolutePage} 页 (原始第 ${bookmark.pageNumber} 页 + 偏移 ${offset})`}
                      >
                        {bookmark.title}
                      </button>
                      <span className="text-[10px] text-natural-accent/70 font-mono font-medium shrink-0 ml-1.5 mt-0.5">
                        P.{getDisplayPage(bookmark.pageNumber)}
                      </span>
                    </div>
                  )}

                  {/* Inline Controls */}
                  {!isEditing && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-80 md:opacity-0 group-hover:opacity-100 hover:opacity-100 transition-all duration-200 shrink-0 bg-white/95 border border-natural-border shadow-md rounded-lg py-1 px-1.5 z-10 animate-fade-in">
                      {/* Shift Nesting Level */}
                      <button
                        onClick={() =>
                          onUpdateBookmark(bookmark.id, {
                            level: Math.max(1, bookmark.level - 1),
                          })
                        }
                        disabled={bookmark.level <= 1}
                        className="p-1 text-[#8E8E88] hover:text-natural-text hover:bg-natural-bg rounded-md disabled:opacity-25"
                        title="升级级别 (偏左)"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        onClick={() =>
                          onUpdateBookmark(bookmark.id, {
                            level: Math.min(5, bookmark.level + 1),
                          })
                        }
                        disabled={bookmark.level >= 5}
                        className="p-1 text-[#8E8E88] hover:text-natural-text hover:bg-natural-bg rounded-md disabled:opacity-25"
                        title="降级级别 (偏右)"
                      >
                        <ChevronRight size={13} />
                      </button>

                      {/* Move Up / Down */}
                      <button
                        onClick={() => onMoveBookmark(bookmark.originalIndex, "up")}
                        disabled={bookmark.originalIndex === 0}
                        className="p-1 text-[#8E8E88] hover:text-natural-text hover:bg-natural-bg rounded-md disabled:opacity-25"
                        title="上移"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => onMoveBookmark(bookmark.originalIndex, "down")}
                        disabled={bookmark.originalIndex === bookmarks.length - 1}
                        className="p-1 text-[#8E8E88] hover:text-natural-text hover:bg-natural-bg rounded-md disabled:opacity-25"
                        title="下移"
                      >
                        <ArrowDown size={13} />
                      </button>

                      {/* Insert new blank outline right below */}
                      <button
                        onClick={() => onAddBookmarkAt(bookmark.originalIndex)}
                        className="p-1 text-[#8E8E88] hover:text-natural-accent hover:bg-natural-aside/40 rounded-md"
                        title="在此书签后插入书签"
                      >
                        <Plus size={13} />
                      </button>

                      {/* Rename */}
                      <button
                        onClick={() => handleStartEdit(bookmark)}
                        className="p-1 text-[#8E8E88] hover:text-natural-accent hover:bg-natural-aside/40 rounded-md"
                        title="编辑"
                      >
                        <Edit3 size={13} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => onDeleteBookmark(bookmark.id)}
                        className="p-1 text-[#8E8E88] hover:text-red-700 hover:bg-red-50 rounded-md"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Manual Insert Footer */}
      <div className="p-4 border-t border-natural-border bg-white shadow-sm">
        <button
          onClick={() => onAddBookmarkAt(bookmarks.length - 1)}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-natural-accent/40 bg-natural-bg text-natural-accent hover:text-white hover:bg-natural-accent hover:border-transparent rounded-lg text-xs font-semibold tracking-wide transition-all shadow-xs cursor-pointer"
        >
          <Plus size={14} /> 添加新大纲节点到末尾
        </button>
      </div>
    </div>
  );
}
