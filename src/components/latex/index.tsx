'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import './latex-styles.css';

// ============================================
// CITATION CONTEXT
// ============================================

interface Reference {
  id: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
}

interface CitationContextType {
  references: Reference[];
  getCiteNumber: (id: string) => number;
}

const CitationContext = createContext<CitationContextType>({
  references: [],
  getCiteNumber: () => 0,
});

// ============================================
// PAPER WRAPPER
// ============================================

interface PaperProps {
  children: ReactNode;
  references: Reference[];
}

export function Paper({ children, references }: PaperProps) {
  const getCiteNumber = (id: string) => {
    const index = references.findIndex(r => r.id === id);
    return index >= 0 ? index + 1 : 0;
  };

  return (
    <CitationContext.Provider value={{ references, getCiteNumber }}>
      <article className="latex-paper">
        {children}
      </article>
    </CitationContext.Provider>
  );
}

// ============================================
// TITLE BLOCK
// ============================================

interface TitleProps {
  title: string;
  subtitle?: string;
  authors: string;
  affiliation?: string;
  date: string;
}

export function Title({ title, subtitle, authors, affiliation, date }: TitleProps) {
  return (
    <header className="latex-title">
      <h1>
        {title}
        {subtitle && <><br />{subtitle}</>}
      </h1>
      <div className="authors">{authors}</div>
      {affiliation && <div className="affiliation">{affiliation}</div>}
      <div className="date">{date}</div>
    </header>
  );
}

// ============================================
// ABSTRACT
// ============================================

interface AbstractProps {
  children: ReactNode;
  keywords?: string[];
}

export function Abstract({ children, keywords }: AbstractProps) {
  return (
    <div className="latex-abstract">
      <div className="latex-abstract-label">Abstract</div>
      <div className="latex-abstract-content">
        {children}
        {keywords && keywords.length > 0 && (
          <div className="latex-keywords">
            <span className="latex-keywords-label">Keywords: </span>
            {keywords.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// SECTION HEADINGS
// ============================================

interface SectionProps {
  number: string;
  title: string;
  level?: 1 | 2 | 3;
  id?: string;
}

export function Section({ number, title, level = 1, id }: SectionProps) {
  const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
  return (
    <Tag className={`latex-section latex-section-${level}`} id={id}>
      <span className="latex-section-number">{number}</span>
      {title}
    </Tag>
  );
}

// ============================================
// EQUATION
// ============================================

interface EquationProps {
  number?: number;
  children: ReactNode;
}

export function Equation({ number, children }: EquationProps) {
  return (
    <div className="latex-equation">
      <span className="latex-equation-content">{children}</span>
      {number && <span className="latex-equation-number">({number})</span>}
    </div>
  );
}

// ============================================
// CITATION
// ============================================

interface CiteProps {
  id: string;
  page?: string;
}

export function Cite({ id, page }: CiteProps) {
  const { getCiteNumber } = useContext(CitationContext);
  const num = getCiteNumber(id);

  return (
    <a href={`#ref-${id}`} className="latex-cite">
      [{num}{page ? `, p. ${page}` : ''}]
    </a>
  );
}

// Author-year citation style
interface CiteAuthorYearProps {
  authors: string;
  year: number;
  id: string;
}

export function CiteAuthorYear({ authors, year, id }: CiteAuthorYearProps) {
  return (
    <a href={`#ref-${id}`} className="latex-cite">
      {authors} ({year})
    </a>
  );
}

// ============================================
// TABLE
// ============================================

interface TableColumn {
  header: string;
  key: string;
  align?: 'left' | 'right' | 'center';
}

interface TableProps {
  number: number;
  caption: string;
  columns: TableColumn[];
  data: Record<string, string | number | ReactNode>[];
}

export function Table({ number, caption, columns, data }: TableProps) {
  return (
    <div className="latex-table-container">
      <table className="latex-table">
        <caption>
          <span className="table-label">Table {number}.</span> {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.align === 'right' ? 'numeric' : ''}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.align === 'right' ? 'numeric' : ''}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// BIBLIOGRAPHY
// ============================================

export function Bibliography() {
  const { references } = useContext(CitationContext);

  return (
    <div className="latex-bibliography">
      <h2>References</h2>
      {references.map((ref, index) => (
        <div key={ref.id} id={`ref-${ref.id}`} className="latex-bib-entry">
          <span className="latex-bib-number">[{index + 1}]</span>
          <div className="latex-bib-content">
            <span className="latex-bib-authors">{ref.authors}</span>
            {' '}({ref.year}).{' '}
            <span className="latex-bib-title">{ref.title}</span>.{' '}
            <span className="latex-bib-journal">{ref.journal}</span>
            {ref.volume && `, ${ref.volume}`}
            {ref.number && `(${ref.number})`}
            {ref.pages && `, ${ref.pages}`}.
            {ref.doi && (
              <>{' '}doi: <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer">{ref.doi}</a></>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// THEOREM / DEFINITION
// ============================================

interface TheoremProps {
  type: 'theorem' | 'definition' | 'hypothesis' | 'proposition';
  number?: number;
  title?: string;
  children: ReactNode;
}

export function Theorem({ type, number, title, children }: TheoremProps) {
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="latex-theorem">
      <div className="latex-theorem-header">
        {typeLabel}{number && ` ${number}`}{title && ` (${title})`}.
      </div>
      {children}
    </div>
  );
}

// ============================================
// FIGURE
// ============================================

interface FigureProps {
  number: number;
  caption: string;
  children: ReactNode;
}

export function Figure({ number, caption, children }: FigureProps) {
  return (
    <figure className="latex-figure">
      {children}
      <figcaption className="latex-figure-caption">
        <span className="latex-figure-label">Figure {number}.</span> {caption}
      </figcaption>
    </figure>
  );
}

// ============================================
// PARAGRAPH (with proper indentation)
// ============================================

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

// ============================================
// HORIZONTAL RULE
// ============================================

export function HR() {
  return <hr className="latex-hr" />;
}

// ============================================
// EXPORTS
// ============================================

export type { Reference, TableColumn };
