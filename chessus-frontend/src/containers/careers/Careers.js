import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import styles from './careers.module.scss';
import StandardButton from '../../components/standardbutton/StandardButton';
import API_URL from '../../global/global';
import { parseServerDate } from '../../helpers/date-formatter';

const Careers = () => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user: currentUser } = useSelector(state => state.authReducer);
  const navigate = useNavigate();

  const isOwner = currentUser && currentUser.role === 'owner';

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch(API_URL + 'careers');
      
      if (!response.ok) {
        throw new Error('Failed to fetch job postings');
      }
      
      const data = await response.json();
      setJobs(data);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching careers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (jobId) => {
    if (!window.confirm('Are you sure you want to delete this job posting?')) {
      return;
    }

    try {
      const response = await fetch(API_URL + `careers/${jobId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ author_id: currentUser?.id })
      });

      if (!response.ok) {
        throw new Error('Failed to delete job posting');
      }

      setJobs(jobs.filter(job => job.article_id !== jobId));
    } catch (err) {
      alert('Error deleting job posting: ' + err.message);
    }
  };

  const handleEdit = (jobId) => {
    navigate(`/careers/edit/${jobId}`);
  };

  const handleCreate = () => {
    navigate('/careers/create');
  };

  const formatDate = (dateString) => {
    return parseServerDate(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const renderMarkdown = (text) => {
    if (!text) return '';
    
    // Simple markdown rendering
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');
  };

  if (loading) {
    return (
      <div className={styles.careersPage}>
        <div className={styles.container}>
          <div className={styles.loading}>Loading job postings...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.careersPage}>
        <div className={styles.container}>
          <div className={styles.error}>Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.careersPage}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Careers at GridGrove</h1>
          <p className={styles.subtitle}>
            Join us in building the future of strategic board games
          </p>
        </div>

        {isOwner && (
          <div className={styles.adminControls}>
            <StandardButton onClick={handleCreate}>
              Create New Job Posting
            </StandardButton>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className={styles.noJobs}>
            <p>No open positions at this time.</p>
            <p>Check back later for opportunities to join our team!</p>
          </div>
        ) : (
          <div className={styles.jobsList}>
            {jobs.map(job => (
              <div key={job.article_id} className={styles.jobCard}>
                <div className={styles.jobHeader}>
                  <h2>{job.title}</h2>
                  <div className={styles.jobMeta}>
                    <span className={styles.date}>
                      Posted {formatDate(job.created_at)}
                    </span>
                  </div>
                </div>

                {job.descript && (
                  <p className={styles.description}>{job.descript}</p>
                )}

                {job.content && (
                  <div 
                    className={styles.content}
                    dangerouslySetInnerHTML={{ 
                      __html: `<p>${renderMarkdown(job.content)}</p>` 
                    }}
                  />
                )}

                {isOwner && (
                  <div className={styles.adminActions}>
                    <StandardButton 
                      onClick={() => handleEdit(job.article_id)}
                      className={styles.editButton}
                    >
                      Edit
                    </StandardButton>
                    <StandardButton 
                      onClick={() => handleDelete(job.article_id)}
                      className={styles.deleteButton}
                    >
                      Delete
                    </StandardButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Careers;
