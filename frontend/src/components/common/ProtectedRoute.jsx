import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const normalizeRole = (role) => String(role || "").toLowerCase();

const ProtectedRoute = ({ children, allowedRoles }) => {
 const { user, isAuthenticated } = useAuth();

 if (!isAuthenticated) {
 return <Navigate to="/" replace />;
 }

 const currentRole = normalizeRole(user?.role);
 const allowed = allowedRoles?.map(normalizeRole) ?? [];

 if (allowedRoles && !allowed.includes(currentRole)) {
 return <Navigate to={`/${currentRole}`} replace />;
 }

 return children;
};

export default ProtectedRoute;
