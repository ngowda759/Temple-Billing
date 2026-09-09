import React from 'react';
import './BookingReceipt.css';

const OmIcon = ({ className }) => (
 <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
 <path d="M46.7,33.1c-1.4-2.8-2.6-5.5-2.6-8.7c0-6,4.5-10.7,10.6-10.7c5.9,0,10.6,4.8,10.6,10.7c0,3-1,5.9-2.7,8.6 c2.6,0.3,5.3,1.3,7.5,3.1c4.5,3.6,6.7,9,6.7,14.6c0,8.8-6,16.5-14.7,18.4c-1.5,0.3-3.1,0.5-4.7,0.5c-4.1,0-8-1.1-11.4-3.2 c-0.6-0.4-0.9-1.1-0.9-1.8v-5.6c0-0.9,0.5-1.7,1.3-2c0.8-0.3,1.7-0.1,2.3,0.5c2.3,2.2,5.3,3.4,8.4,3.4c1.1,0,2.1-0.1,3.1-0.3 c5-1,8.9-5.6,8.9-10.8c0-3.6-1.8-6.9-4.8-8.8c-2.4-1.5-5.3-2.1-8.1-1.7c-0.6,0.1-1.3-0.2-1.7-0.7c-0.4-0.5-0.5-1.2-0.3-1.8 c0.9-2.3,1.3-4.7,1.3-7.2c0-3.4-2.2-6.1-5.1-6.1c-2.9,0-5.1,2.7-5.1,6.1c0,2.2,0.7,4.3,2.1,6.1c0.5,0.6,0.5,1.5,0,2.1 c-0.5,0.6-1.4,0.7-2,0.2c-3.1-2.4-5.3-5.7-6.2-9.6c-0.2-0.8-1-1.2-1.7-1c-0.8,0.2-1.2,1-1,1.7c1.3,4.6,4.3,8.5,8.2,11.2 c-2.4,2.8-3.9,6.5-3.9,10.4c0,3,0.9,5.9,2.6,8.4c-4.4,2.9-7.1,7.9-7.1,13.2c0,8.8,7.2,16,16,16c2,0,4-0.4,5.9-1.1 c0.8-0.3,1.2-1.2,0.9-2c-0.3-0.8-1.2-1.2-2-0.9c-1.5,0.6-3.1,0.9-4.8,0.9c-6.8,0-12.4-5.6-12.4-12.4c0-4.5,2.4-8.6,6.3-10.7 c0.6-0.3,1-0.9,1-1.6c0-0.7-0.4-1.3-1-1.6c-1.7-1.1-2.7-2.9-2.7-4.9C39.4,40.1,42.4,36,46.7,33.1z M62.2,20.4c0,0.8-0.7,1.5-1.5,1.5 h-7.4c-0.8,0-1.5-0.7-1.5-1.5s0.7-1.5,1.5-1.5h7.4C61.6,18.9,62.2,19.6,62.2,20.4z M58.5,14.6c2.4,0,4.4-2,4.4-4.4 c0-2.4-2-4.4-4.4-4.4c-2.4,0-4.4,2-4.4,4.4C54.1,12.6,56.1,14.6,58.5,14.6z"/>
 </svg>
);

const TempleIcon = ({ className }) => (
 <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
 <path d="M50,5 L55,20 L65,25 L65,40 L75,50 L75,85 L25,85 L25,50 L35,40 L35,25 L45,20 Z" />
 <rect x="42" y="60" width="16" height="25" fill="none" stroke="currentColor" strokeWidth="2" />
 <line x1="20" y1="85" x2="80" y2="85" stroke="currentColor" strokeWidth="4" />
 <line x1="30" y1="40" x2="70" y2="40" stroke="currentColor" strokeWidth="2" />
 <line x1="35" y1="25" x2="65" y2="25" stroke="currentColor" strokeWidth="2" />
 </svg>
);

const CornerSVG = () => (
 <svg className="corner-svg" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
 <path d="M0 0 L40 0 L40 5 L5 5 L5 40 L0 40 Z" />
 <circle cx="15" cy="15" r="3" />
 <circle cx="25" cy="15" r="2" />
 <circle cx="15" cy="25" r="2" />
 <path d="M5 5 Q 20 20 35 15" fill="none" stroke="currentColor" strokeWidth="1" />
 </svg>
);

const DesktopIcon = ({ className }) => (
 <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
 <line x1="8" y1="21" x2="16" y2="21"></line>
 <line x1="12" y1="17" x2="12" y2="21"></line>
 </svg>
);

const QRCodePlaceholder = ({ className }) => (
 <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
 <rect x="7" y="7" width="3" height="3"></rect>
 <rect x="14" y="7" width="3" height="3"></rect>
 <rect x="7" y="14" width="3" height="3"></rect>
 <rect x="14" y="14" width="3" height="3"></rect>
 <line x1="10" y1="14" x2="14" y2="14"></line>
 <line x1="14" y1="10" x2="14" y2="14"></line>
 </svg>
);

const BookingReceipt = ({
 isOnline = true,
 receiptNo = "REC-ON-2025-000123",
 bookingDate = "27 May 2025 10:45 AM",
 paymentMode = "UPI",
 transactionId = "UPI/512345678901",
 cashierName = "Deepthi S.",
 devoteeName = "Ramesh Bhat",
 mobile = "9876543210",
 email = "ramesh@example.com",
 address = "#12, Temple Street, Udupi - 576101",
 poojaBookings = [
 { slNo: 1, name: "Satyanarayana Pooja", date: "29 May 2025", qty: 1, amount: 500.00 }
 ],
 prasadamOrders = [
 { slNo: 2, name: "Laddu Prasadam", date: "-", qty: "2 Plate", amount: 100.00 }
 ],
 subTotal = 680.00,
 templeCharges = 50.00,
 grandTotal = 730.00,
 amountInWords = "Rupees Seven Hundred Thirty Only",
 devoteeMaterials = [],
 templeMaterials = [],
 notes = [
 "Please report 15 minutes before the Pooja time.",
 "Pooja once booked will not be cancelled.",
 "Prasadam will be provided after Pooja."
 ]
}) => {
 const themeClass = isOnline ? 'theme-online' : 'theme-offline';
 
 return (
 <div className={`receipt-wrapper ${themeClass}`}>
 <div className="receipt-container">
 
 {/* Borders */}
 <div className="receipt-inner-border"></div>
 
 <div className="corner-flourish corner-tl"><CornerSVG /></div>
 <div className="corner-flourish corner-tr"><CornerSVG /></div>
 <div className="corner-flourish corner-bl"><CornerSVG /></div>
 <div className="corner-flourish corner-br"><CornerSVG /></div>
 
 {/* Top Badge */}
 <div className="top-badge-container">
 <div className="top-badge">
 <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
 {isOnline ? (
 <>
 <circle cx="12" cy="12" r="10"></circle>
 <line x1="2" y1="12" x2="22" y2="12"></line>
 <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
 </>
 ) : (
 <>
 <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
 <circle cx="12" cy="7" r="4"></circle>
 </>
 )}
 </svg>
 {isOnline ? 'ONLINE BOOKING RECEIPT' : 'OFFLINE BOOKING RECEIPT'}
 </div>
 </div>
 
 {/* Header */}
 <div className="receipt-header">
 <TempleIcon className="temple-img" />
 <div className="header-center">
 <h1 className="temple-name">SRI SHANTI MAHADEV MANDIR</h1>
 <p className="temple-address">Main Road, Udupi - 576101, Karnataka</p>
 <p className="temple-contact">📞 0824-1234567   🌐 www.srishantimandir.org</p>
 <p className="chant-line">|| Om Namah Shivaya ||</p>
 </div>
 <OmIcon className="om-symbol" />
 </div>
 
 <div className="receipt-title-wrapper">
 <div className="ornamental-line ornamental-line-left"></div>
 <div className="receipt-badge">RECEIPT</div>
 <div className="ornamental-line ornamental-line-right"></div>
 </div>
 
 {/* Details Panel */}
 <div className="details-panel">
 <div className="details-col details-col-left">
 <div className="detail-row">
 <span className="detail-label">Receipt No.</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">{receiptNo}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label">Booking Date</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">{bookingDate}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label">Payment Mode</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">{paymentMode}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label">Transaction ID</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">
 {paymentMode === "Cash" || paymentMode === "Offline" ? "Offline Payment" : (transactionId || "-")}
 </span>
 </div>
 {!isOnline && (
 <div className="detail-row">
 <span className="detail-label">Cashier Name</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">{cashierName}</span>
 </div>
 )}
 </div>
 
 <div className="details-col">
 <div className="col-header">Devotee Details</div>
 <div className="detail-row">
 <span className="detail-label" style={{width: '70px'}}>Name</span>
 <span className="detail-colon">:</span>
 <span className="detail-value devotee-name">{devoteeName}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label" style={{width: '70px'}}>Mobile</span>
 <span className="detail-colon">:</span>
 <span className="detail-value">{mobile}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label" style={{width: '70px'}}>Email</span>
 <span className="detail-colon">:</span>
 <span className="detail-value" style={{maxWidth: '180px', wordBreak: 'break-all'}}>{email}</span>
 </div>
 <div className="detail-row">
 <span className="detail-label" style={{width: '70px'}}>Address</span>
 <span className="detail-colon">:</span>
 <span className="detail-value" style={{maxWidth: '180px'}}>{address}</span>
 </div>
 </div>
 </div>
 
 {/* Table Section */}
 <div className="booking-details-wrapper">
 <div className="section-badge">BOOKING DETAILS</div>
 <table className="receipt-table">
 <thead>
 <tr>
 <th style={{paddingTop: '30px', width: '10%'}}>Sl. No.</th>
 <th style={{paddingTop: '30px', width: '40%'}}>Item / Service</th>
 <th style={{paddingTop: '30px', width: '20%'}}>Date</th>
 <th style={{paddingTop: '30px', width: '15%'}}>Qty</th>
 <th style={{paddingTop: '30px', width: '15%'}}>Amount (₹)</th>
 </tr>
 </thead>
 <tbody>
 {poojaBookings.length > 0 && (
 <>
 <tr>
 <td colSpan="5" className="category-row">POOJA BOOKING</td>
 </tr>
 {poojaBookings.map((item, idx) => (
 <tr key={`pooja-${idx}`}>
 <td>{item.slNo}</td>
 <td style={{textAlign: 'left'}}>{item.name}</td>
 <td>{item.date}</td>
 <td>{item.qty}</td>
 <td style={{textAlign: 'right'}}>{item.amount.toFixed(2)}</td>
 </tr>
 ))}
 </>
 )}
 
 {prasadamOrders.length > 0 && (
 <>
 <tr>
 <td colSpan="5" className="category-row">PRASADAM ORDER</td>
 </tr>
 {prasadamOrders.map((item, idx) => (
 <tr key={`prasad-${idx}`}>
 <td>{item.slNo}</td>
 <td style={{textAlign: 'left'}}>{item.name}</td>
 <td>{item.date}</td>
 <td>{item.qty}</td>
 <td style={{textAlign: 'right'}}>{item.amount.toFixed(2)}</td>
 </tr>
 ))}
 </>
 )}
 </tbody>
 </table>
 </div>
 
 {/* Footer Panels */}
 <div className="footer-panels">
 <div className="materials-panel">
 {devoteeMaterials && devoteeMaterials.length > 0 && (
 <>
 <div className="materials-title">
 <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
 <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
 <line x1="16" y1="2" x2="16" y2="6"></line>
 <line x1="8" y1="2" x2="8" y2="6"></line>
 <line x1="3" y1="10" x2="21" y2="10"></line>
 </svg>
 To be Brought by Devotee
 </div>
 <ul className="materials-list" style={{ marginBottom: templeMaterials && templeMaterials.length > 0 ? '12px' : '0' }}>
 {devoteeMaterials.map((mat, i) => (
 <li key={i}>{mat}</li>
 ))}
 </ul>
 </>
 )}

 {templeMaterials && templeMaterials.length > 0 && (
 <>
 <div className="materials-title">
 <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
 <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
 </svg>
 Arranged by Temple
 </div>
 <ul className="materials-list">
 {templeMaterials.map((mat, i) => (
 <li key={i}>{mat}</li>
 ))}
 </ul>
 </>
 )}

 {(!devoteeMaterials || devoteeMaterials.length === 0) && (!templeMaterials || templeMaterials.length === 0) && (
 <div className="materials-title" style={{ color: '#888', fontStyle: 'italic', borderBottom: 'none' }}>
 No specific materials required.
 </div>
 )}
 </div>
 
 <div className="totals-panel">
 <div className="total-row">
 <span>Sub Total</span>
 <span>₹ {subTotal.toFixed(2)}</span>
 </div>
 <div className="total-row">
 <span>Temple Arrange Charges</span>
 <span>+ ₹ {templeCharges.toFixed(2)}</span>
 </div>
 <div className="grand-total-row">
 <span>GRAND TOTAL</span>
 <span>₹ {grandTotal.toFixed(2)}</span>
 </div>
 <div className="amount-words">
 ({amountInWords})
 </div>
 </div>
 </div>
 
 {/* Notes */}
 <div className="notes-section">
 <div className="notes-title">
 <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
 <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
 <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
 </svg>
 Notes:
 </div>
 <ul>
 {notes.map((note, i) => (
 <li key={i}>{note}</li>
 ))}
 </ul>
 </div>
 
 {/* Bottom Info Banner */}
 <div className="bottom-info-banner">
 <div className="bottom-info-left">
 <DesktopIcon className="computer-icon" />
 <div>
 <div className="info-text-main">
 This is an {isOnline ? 'online' : 'offline'} booking receipt.
 </div>
 <div className="info-text-sub">
 For any queries, visit our website www.srishantimandir.org
 </div>
 </div>
 </div>
 <QRCodePlaceholder className="qr-placeholder" />
 </div>
 
 {/* Visit Again */}
 <div className="visit-again">
 <div className="ornamental-line ornamental-line-left" style={{width: '30px'}}></div>
 Thank You! Visit Again!
 <div className="ornamental-line ornamental-line-right" style={{width: '30px'}}></div>
 </div>
 
 </div>
 </div>
 );
};

export default BookingReceipt;
