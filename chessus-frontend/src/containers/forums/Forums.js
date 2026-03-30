import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./forums.module.scss";
import StandardButton from "../../components/standardbutton/StandardButton";
import { forums, firstForumsRender } from "../../actions/forums";
import { formatDateLegacy } from "../../helpers/date-formatter";
import Pagination from "../../components/pagination/Pagination";

const Forums = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const firstRender = useSelector((state) => state.forums.first_forums_render);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(forums(currentPage, 20));
    if (!firstRender) {
      dispatch(firstForumsRender());
    }
  }, [currentPage, firstRender, dispatch]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function createNewPost() {
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to create a forum post." } });
      return;
    }
    navigate("/forums/new");
  }

  function handleRowClick(forumId, e) {
    // Don't navigate if clicking on a link
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    navigate(`/forums/${forumId}`);
  }



  // Filter forums to only show general forums (those without game_type_id)
  const generalForums = allForums.forums ? 
    allForums.forums.filter(forum => forum.game_type_id === null) : [];

  // Filter by search term
  const filteredForums = generalForums.filter(forum => 
    forum.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (forum.content && forum.content.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (forum.author_name && forum.author_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="container">
      <header className="jumbotron">
        <h3 className={styles["forum-page-title"]}>
          General Forums
        </h3>
      </header>
      
      <div className={styles["search-container"]}>
        <input
          type="text"
          placeholder="Search forums..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles["search-input"]}
        />
      </div>

    <div className={styles["forums"]}>
      {/* This line allows the fake forum with idk of -1 to load in upon deletion of the last article from state, immediately switching to
      rendering "No Forums Found" instead of having a blank table until refresh. */}
      {filteredForums && filteredForums.length > 0 ? 
    <table className={styles["forums-table"]}>
      <tbody>
        <tr>
          <th>
            Subject
          </th>
          <th>
            Written By
          </th>
          <th>
            Replies
          </th>
          <th>
            Likes
          </th>
          <th>
            Content
          </th>
          <th>
            Created At
          </th>
        </tr>
          {
            filteredForums.map(function(forum) {
              return (
                <tr 
                  key={forum.id} 
                  className={styles["forum-row"]}
                  onClick={(e) => handleRowClick(forum.id, e)}
                >
                    <td>
                      <div className={styles["forums-link"]}>
                        <strong><div className={styles["forum-title"]}>{ forum.title }</div></strong> <br/> <div className={styles["forums-comments-likes"]}></div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        { forum.author_name && forum.author_name !== 'Anonymous' ? 
                          <Link to={`/profile/${forum.author_name}`} onClick={(e) => e.stopPropagation()}>
                            <div className={styles["forums-username"]}>{ forum.author_name }</div>
                          </Link>
                        : 
                          <div className={styles["forums-username"]}>{ forum.author_name || 'User Deleted' }</div>
                      
                      }
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        <div className={styles["forums-comment-likes"]}>{forum.comment_count}</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        <div className={styles["forums-comment-likes"]}>{forum.likes ? forum.likes.length : 0}</div>
                      </div>
                    </td>
                    <td className={styles["forums-link-content"]}>
                      <div className={styles["forum-content"]}>
                        {forum.content}
                      </div>
                    </td>
                    <td className={styles["date-td"]}>
                      <div className={styles["forums-date"]}>
                        {
                        formatDateLegacy(forum.created_at)
                        }
                      </div>
                    </td>
                </tr>
              )
            })
          }
      </tbody>
    </table>
    : 
    <h1>{searchTerm ? "No forums found matching your search" : "No Forums Found"}</h1>
      }
    </div>

      {allForums.pagination && !searchTerm && (
        <Pagination
          currentPage={allForums.pagination.page}
          totalPages={allForums.pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}

      <div className="buttons">
        <StandardButton buttonText={"Create New Post"} onClick={createNewPost}/>
      </div>
    </div>
  );
};

export default Forums;