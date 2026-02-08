import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import styles from "./career-editor.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import API_URL from "../../global/global";

const CareerEditor = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { jobId } = useParams();
  const isEditMode = !!jobId;
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(isEditMode);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const isOwner = currentUser && currentUser.role === 'owner';

  // Fetch existing job data if in edit mode
  useEffect(() => {
    if (isEditMode) {
      fetchJob();
    }
  }, [jobId]);

  const fetchJob = async () => {
    try {
      setFetchLoading(true);
      const response = await fetch(API_URL + `careers/${jobId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch job posting');
      }
      
      const job = await response.json();
      setTitle(job.title || '');
      setDescription(job.descript || '');
      setContent(job.content || '');
    } catch (err) {
      setError(err.message);
      console.error('Error fetching job:', err);
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setError('Job title is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const endpoint = isEditMode 
        ? API_URL + `careers/${jobId}` 
        : API_URL + 'careers';
      
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          descript: description.trim(),
          content: content.trim(),
          author_id: currentUser.id
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save job posting');
      }

      navigate('/careers');
    } catch (err) {
      setError(err.message);
      console.error('Error saving job:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/careers');
  };

  // Redirect non-owners
  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  if (!isOwner) {
    return <Navigate to="/careers" />;
  }

  if (fetchLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.wrapper}>
          <div className={styles.loading}>Loading job posting...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <h1 className={styles.pageTitle}>
          {isEditMode ? 'Edit Job Posting' : 'Create New Job Posting'}
        </h1>
        
        <form onSubmit={handleSubmit}>
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}
          
          <div className={styles.formGroup}>
            <label htmlFor="title" className={styles.fieldLabel}>
              Job Title <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              id="title"
              className={styles.titleInput}
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Software Developer, Community Manager"
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="description" className={styles.fieldLabel}>
              Short Description
            </label>
            <input
              type="text"
              id="description"
              className={styles.titleInput}
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of the position"
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="content" className={styles.fieldLabel}>
              Full Job Description
            </label>
            <textarea
              id="content"
              className={styles.contentInput}
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter the full job description, responsibilities, requirements, etc."
              disabled={loading}
            />
            <p className={styles.hint}>
              Supports basic markdown: **bold**, *italic*, new lines
            </p>
          </div>

          <div className={styles.buttonGroup}>
            <StandardButton 
              buttonText={loading ? 'Saving...' : (isEditMode ? 'Update Job' : 'Create Job')}
              onClick={handleSubmit}
              disabled={loading}
            />
            <StandardButton 
              buttonText="Cancel"
              onClick={handleCancel}
              disabled={loading}
              className={styles.cancelButton}
            />
          </div>
        </form>
      </div>
    </div>
  );
};

export default CareerEditor;
