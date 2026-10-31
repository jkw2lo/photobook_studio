// PDFKit's browser build needs its standard fonts registered (it can't read them from disk).
declare module 'pdfkit/standard-fonts/Helvetica' {
  const font: object;
  export default font;
}
