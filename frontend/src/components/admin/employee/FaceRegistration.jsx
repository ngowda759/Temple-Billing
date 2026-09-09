import React, { useRef, useState, useEffect } from "react";
import * as faceapi from "@vladmandic/face-api";
import { FiCamera, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { registerEmployeeFace } from "../../../services/employeeService";

const FaceRegistration = ({ employee, onComplete, onRegistrationComplete }) => {
 const videoRef = useRef(null);
 const canvasRef = useRef(null);
 
 const [modelsLoaded, setModelsLoaded] = useState(false);
 const [stream, setStream] = useState(null);
 const [message, setMessage] = useState("Loading face recognition models...");
 const [isCapturing, setIsCapturing] = useState(false);
 const streamRef = useRef(null);

 const [descriptors, setDescriptors] = useState([]);
 const [photos, setPhotos] = useState([]);
 const [registrationSuccess, setRegistrationSuccess] = useState(false);

 useEffect(() => {
 const loadModels = async () => {
 try {
 const MODEL_URL = "/models";
 await Promise.all([
 faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
 faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
 faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
 ]);
 setModelsLoaded(true);
 setMessage("Ready to register face.");
 } catch (err) {
 console.error("Error loading models", err);
 setMessage("Failed to load face recognition models.");
 }
 };
 loadModels();
 }, []);

 const startVideo = () => {
 setDescriptors([]);
 setPhotos([]);
 setRegistrationSuccess(false);
 
 navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
 .then((currentStream) => {
 setStream(currentStream);
 streamRef.current = currentStream;
 if (videoRef.current) {
 videoRef.current.srcObject = currentStream;
 }
 setMessage("Please look at the camera. We need to capture 5 angles.");
 })
 .catch((err) => {
 console.error("Error accessing webcam", err);
 setMessage("Unable to access camera.");
 });
 };

 const stopVideo = () => {
 if (streamRef.current) {
 streamRef.current.getTracks().forEach((track) => track.stop());
 streamRef.current = null;
 setStream(null);
 }
 };

 useEffect(() => {
 return () => stopVideo();
 }, []);

 const captureAngle = async () => {
 if (!videoRef.current || !modelsLoaded) return;
 setIsCapturing(true);
 setMessage("Detecting face...");
 try {
 const detection = await faceapi.detectSingleFace(videoRef.current).withFaceLandmarks().withFaceDescriptor();
 if (!detection) {
 setMessage("No face detected. Please ensure your face is clearly visible.");
 setIsCapturing(false);
 return;
 }

 const canvas = document.createElement("canvas");
 canvas.width = videoRef.current.videoWidth;
 canvas.height = videoRef.current.videoHeight;
 const ctx = canvas.getContext("2d");
 ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
 const photo = canvas.toDataURL("image/jpeg", 0.7);

 const newDescriptors = [...descriptors, Array.from(detection.descriptor)];
 const newPhotos = [...photos, photo];
 setDescriptors(newDescriptors);
 setPhotos(newPhotos);

 if (newDescriptors.length >= 5) {
 setMessage("Processing face registration...");
 const avgDescriptor = new Array(128).fill(0);
 for (let i = 0; i < 128; i++) {
 let sum = 0;
 for (let j = 0; j < newDescriptors.length; j++) {
 sum += newDescriptors[j][i];
 }
 avgDescriptor[i] = sum / newDescriptors.length;
 }
 
 setRegistrationSuccess(true);
 setMessage("Face Registered Successfully");
 stopVideo();
 
 const faceData = {
 faceRegistered: true,
 faceDescriptor: avgDescriptor,
 profilePhoto: newPhotos[0],
 facePhotos: newPhotos
 };
 
 if (employee && employee._id) {
 setMessage("Saving face data to database...");
 try {
 const res = await registerEmployeeFace(employee._id, faceData);
 setMessage("Face Registered and Saved Successfully");
 if (onComplete) {
 onComplete(res.employee);
 }
 } catch (err) {
 console.error("Error saving face data:", err);
 setMessage("Face captured but failed to save to database.");
 }
 } else if (onRegistrationComplete) {
 onRegistrationComplete(faceData);
 }
 } else {
 setMessage(`Captured ${newDescriptors.length}/5. Please slightly change your angle.`);
 }
 } catch (error) {
 console.error(error);
 setMessage("An error occurred during capture.");
 } finally {
 setIsCapturing(false);
 }
 };

 if (registrationSuccess) {
 return (
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5 flex flex-col items-center">
 <FiCheckCircle className="text-emerald-500 text-5xl mb-2" />
 <h3 className="text-lg font-bold text-emerald-800">Face Registered Successfully</h3>
 <p className="text-sm text-emerald-600 mb-4">5 angles captured and processed.</p>
 <div className="flex gap-2">
 {photos.map((p, idx) => (
 <img key={idx} src={p} alt={`Angle ${idx+1}`} className="w-12 h-12 object-cover rounded-md border border-emerald-300" />
 ))}
 </div>
 <button onClick={startVideo} className="mt-4 px-4 py-2 bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-slate-700 dark:text-slate-200 font-semibold rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 transition">
 Retake Registration
 </button>
 </div>
 );
 }

 return (
 <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] p-5">
 <h3 className="text-xl font-bold mb-4">Face Registration</h3>
 <div className="flex flex-col items-center">
 {message && <p className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200 ">{message}</p>}
 
 {!stream && (
 <button onClick={startVideo} disabled={!modelsLoaded} className="flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-white transition hover:bg-slate-800 disabled:opacity-50">
 <FiCamera /> Start Camera
 </button>
 )}
 
 <div className="relative mt-4">
 <video ref={videoRef} autoPlay muted playsInline className={`rounded-xl shadow ${stream ? "block" : "hidden"}`} style={{ width: "400px", height: "auto" }} />
 {stream && (
 <div className="absolute top-3 right-3 bg-blue-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] text-blue-800 px-3 py-1 text-xs font-bold rounded-full shadow-lg">
 {descriptors.length}/5 Captured
 </div>
 )}
 </div>
 
 {stream && (
 <div className="mt-4 flex gap-4">
 <button onClick={captureAngle} disabled={isCapturing} className="flex items-center gap-2 rounded-full bg-green-600 px-6 py-3 text-white transition hover:bg-green-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 disabled:opacity-50">
 <FiCheckCircle /> {isCapturing ? "Capturing..." : "Capture Angle"}
 </button>
 <button onClick={stopVideo} className="flex items-center gap-2 rounded-full border border-slate-300 dark:border-slate-700 bg-temple-100 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] px-6 py-3 text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200 dark:border-slate-700 ">
 <FiXCircle /> Cancel
 </button>
 </div>
 )}
 </div>
 </div>
 );
};

export default FaceRegistration;
