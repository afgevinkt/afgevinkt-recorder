export default function Logo() {
  return (
    <div className="logo">
      <img
        src="/afgevinkt-check.svg"
        alt=""
        aria-hidden="true"
        style={{ height: 30, width: "auto", flex: "none" }}
      />
      <span>
        <b>
          Afgevinkt<i>!</i>
        </b>
        <small>RECORDER</small>
      </span>
    </div>
  );
}
